import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { postedAccountingFixture } from '../../../tests/fixtures/accounting-posted';
import { FinancialControlService } from './financial-control-service';
import { FuelReadService } from './fuel-read-service';
import { BankLedgerService } from './bank-ledger-service';
import { reviewQueues } from './accounting-read-model';
after(() => prisma.$disconnect());
test('posted five-invoice fixture: read views preserve all economics, attribution and settlement protections', async () => {
  const fixture = await postedAccountingFixture(); const { context } = fixture;
  const service = new FinancialControlService(); const fuelService = new FuelReadService(); const bankService = new BankLedgerService();
  try {
    const snapshot = () => prisma.financialTransaction.findMany({ where:{operatingGroupId:context.operatingGroupId},include:{allocations:true,evidence:true},orderBy:{id:'asc'} });
    const before = await snapshot();
    assert.equal(before.length,699); assert.equal(before.reduce((n,t)=>n+t.allocations.length,0),1083); assert.equal(before.reduce((n,t)=>n+t.evidence.length,0),1083);
    const overview = await service.overview(context);
    assert.equal(overview.business.incomeMinor,'0'); assert.equal(overview.business.netExpensesMinor,'40955325'); assert.equal(overview.business.expenseCreditsMinor,'-2859');
    assert.equal(overview.exceptions.uncategorizedExpenses,0); assert.equal(overview.payments.settled,5);
    for (const queue of ['uncategorizedExpenses','unmatchedInflows','unmatchedOutflows','ownerRecovery','missingAssignments'] as const) assert.equal((await service.transactionPage(context,queue)).total,overview.exceptions[queue]);
    assert.equal((await service.transactionPage(context)).rows.length,25);
    const expectedIds = before.slice().sort((a,b) => b.transactionDate.getTime()-a.transactionDate.getTime() || b.createdAt.getTime()-a.createdAt.getTime() || b.id.localeCompare(a.id)).map(row=>row.id);
    const pageIds: string[] = [];
    for (let page=1;page<=28;page++) {
      const result = await service.transactionPage(context,'',page);
      assert.equal(result.total,699); assert.ok(result.rows.length<=25);
      pageIds.push(...result.rows.map(row=>row.id));
    }
    assert.deepEqual(pageIds,expectedIds);
    assert.equal((await service.transactionPage(context,'',99999)).page,28);
    assert.equal((await service.transactionPage(context,'',-1)).page,1);
    await assert.rejects(()=>service.transactionPage(context,'toString'),/Unknown review queue/);
    const fuel = await fuelService.overview(context); const fuel2 = await fuelService.overview(context,2);
    assert.equal(fuel.events,698); assert.equal(fuel.trucks,50); assert.equal(fuel.netExpenseMinor,'40955325'); assert.equal(fuel.adjustmentsMinor,'-2859');
    assert.equal(fuel.products.TRUCK_DIESEL.amountMinor,'38582162'); assert.equal(fuel.products.REEFER_FUEL.amountMinor,'1021818'); assert.equal(fuel.products.DEF.amountMinor,'1354204');
    assert.equal([...fuel.byTruck.rows,...fuel2.byTruck.rows].reduce((sum,row)=>sum+BigInt(row.amountMinor),BigInt(0)),BigInt(40958184));
    assert.ok([...fuel.byTruck.rows,...fuel2.byTruck.rows].some(row=>row.unitNumber==='8558' && row.status==='INACTIVE'));
    assert.equal(new Set([...fuel.byTruck.rows,...fuel2.byTruck.rows].map(row=>row.id)).size,50);
    assert.equal((await fuelService.overview(context,99999)).byTruck.page,2);
    assert.equal((await bankService.listTransactions(context,{inbox:true,page:1})).total,0);
    assert.equal((await bankService.listTransactions(context,{page:1})).total,5);
    await assert.rejects(()=>bankService.classifyTransaction(context,fixture.banks[0],{categoryId:fixture.category.id,scope:'COMPANY_LEVEL',reviewStatus:'REVIEWED',allocations:[]}),/settlement evidence/);
    await assert.rejects(()=>service.replaceAllocations(before[0].id,[{amount:'1.00',categoryId:fixture.category.id}],context),/posted provider/);
    // Corrected/partial settlement records must remain visible for review, with protection intact.
    await prisma.bankTransactionClassification.update({where:{bankTransactionId:fixture.banks[0]},data:{reconciliationStatus:'DISCREPANCY',reviewStatus:'NEEDS_REVIEW'}});
    assert.equal((await bankService.listTransactions(context,{inbox:true,page:1})).total,1);
    await prisma.bankTransactionClassification.update({where:{bankTransactionId:fixture.banks[0]},data:{reconciliationStatus:'MATCHED',reviewStatus:'UNREVIEWED'}});
    for (const change of [{pending:true}, {pending:false,removedAt:new Date()}, {removedAt:null,lifecycle:'PENDING' as const}]) {
      await prisma.bankTransaction.update({where:{id:fixture.banks[0]},data:change});
      assert.equal((await bankService.listTransactions(context,{inbox:true,page:1})).total,1);
    }
    assert.deepEqual(await snapshot(),before);
    assert.equal(await prisma.pilotFuelingEvent.count({where:{invoice:{operatingGroupId:context.operatingGroupId}}}),698);
    assert.equal(await prisma.financialExpectation.count({where:{operatingGroupId:context.operatingGroupId,status:'MATCHED'}}),5);
    assert.equal(await prisma.financialExpectation.count({where:{operatingGroupId:context.operatingGroupId,status:'OPEN'}}),0);
    assert.equal(await prisma.financialExpectationBankMatch.count({where:{operatingGroupId:context.operatingGroupId}}),5);
    // Create only synthetic review cases after proving the protected-shape snapshot.
    const date = new Date('2026-09-01T00:00:00Z');
    await prisma.financialTransaction.createMany({data:Array.from({length:31},(_,i)=>({
      operatingGroupId:context.operatingGroupId,companyId:context.activeCompanyId,createdByUserId:context.userId,
      transactionDate:date,createdAt:date,amountMinor:BigInt(100),description:`Review ${i}`,direction:i===0?'INFLOW':'OUTFLOW',
      reconciliationStatus:i===1?'PARTIALLY_MATCHED':i===2?'DUPLICATE_SUSPECTED':'UNREVIEWED',
      recoverableFromOwner:true,expectedRecoveryMinor:BigInt(100),waivedAmountMinor:BigInt(i===3?100:0),recoveryStatus:i===3?'WAIVED':'EXPECTED',
    }))});
    const changed = await service.overview(context);
    for (const queue of Object.keys(reviewQueues) as (keyof typeof reviewQueues)[]) {
      const first = await service.transactionPage(context,queue,1);
      assert.equal(first.total,changed.exceptions[queue]);
      const ids = [...first.rows.map(row=>row.id)];
      for(let page=2;page<=Math.ceil(first.total/25);page++) ids.push(...(await service.transactionPage(context,queue,page)).rows.map(row=>row.id));
      assert.equal(new Set(ids).size,first.total);
    }
    assert.equal(changed.exceptions.ownerRecovery,30);
    await service.createExpectation({description:'Open payment',amount:'10.00',direction:'OUTFLOW',expectedDateStart:'2026-09-01',expectedDateEnd:'2026-09-02'},context);
    assert.equal((await service.overview(context)).exceptions.missingExpected,(await service.listExpectations(context)).filter(row=>['OPEN','PARTIALLY_MATCHED','MISSING'].includes(row.status)).length);
    const bank = await prisma.bankTransaction.findUniqueOrThrow({where:{id:fixture.banks[0]}});
    await prisma.bankTransaction.update({where:{id:bank.id},data:{pending:false,removedAt:null,lifecycle:'POSTED'}});
    for(const status of ['PARTIALLY_MATCHED','DISCREPANCY'] as const) {
      await prisma.bankTransactionClassification.update({where:{bankTransactionId:bank.id},data:{reconciliationStatus:status}});
      assert.equal((await bankService.listTransactions(context,{inbox:true,page:1})).total,1);
    }
    await prisma.bankTransactionClassification.update({where:{bankTransactionId:bank.id},data:{reconciliationStatus:'MATCHED'}});
    const bankIds = Array.from({length:511},(_,i)=>`${bank.id}-review-${String(i).padStart(3,'0')}`);
    await prisma.bankTransaction.createMany({data:bankIds.map((id,i)=>({id,bankAccountId:bank.bankAccountId,companyId:context.activeCompanyId,date,amount:1,amountMinor:BigInt(100),name:'Review bank',originalDescription:'Review bank',direction:i===510?'INFLOW':'OUTFLOW'}))});
    await prisma.bankTransactionClassification.createMany({data:bankIds.map((bankTransactionId,i)=>({bankTransactionId,categoryId:fixture.category.id,reviewStatus:i===0?'REVIEWED':'UNREVIEWED'}))});
    assert.equal((await bankService.listTransactions(context,{inbox:true,page:1})).total,510);
    const bankPages: string[] = [];
    for(let page=1;page<=11;page++) {
      const result=await bankService.listTransactions(context,{inbox:true,page});
      assert.equal(result.total,510); assert.ok(result.length<=50); bankPages.push(...result.map(row=>row.id));
    }
    assert.deepEqual(bankPages,bankIds.slice(1).sort().reverse());
    assert.equal((await bankService.listTransactions(context,{page:1,categoryId:fixture.category.id,reviewStatus:'REVIEWED'})).total,1);
    assert.equal((await bankService.listTransactions(context,{inbox:true,page:1,direction:'INFLOW'})).total,1);
    assert.equal((await bankService.listTransactions(context,{inbox:true,page:1,query:'not present'})).total,0);
    await assert.rejects(()=>bankService.listTransactions(context,{companyId:'foreign-company',page:1}));
    assert.equal((await fuelService.overview(context)).netExpenseMinor,'40955325');
  } finally { await fixture.cleanup(); }
});
test('Fuel pagination order is deterministic when company names and numeric Truck labels tie', async () => {
  const truck = (id: string, unitNumber: string) => ({id,unitNumber,companyId:'company',company:{name:'Same company'},status:'ACTIVE'});
  const events = [truck('b','01'),truck('a','1')].map(truck=>({id:truck.id,truckId:truck.id,truck,productLines:[]}));
  const database = {pilotProviderInvoice:{findMany:async()=>[{id:'invoice',invoiceTotalMinor:BigInt(0),expectation:null,adjustments:[],events}]}};
  const service = new FuelReadService(database as unknown as typeof prisma);
  const context = {userId:'user',activeCompanyId:'company',companyIds:['company'],operatingGroupId:'group',role:'OWNER' as const};
  assert.deepEqual((await service.overview(context)).byTruck.rows.map(row=>row.id),['a','b']);
  events.reverse();
  assert.deepEqual((await service.overview(context)).byTruck.rows.map(row=>row.id),['a','b']);
});
