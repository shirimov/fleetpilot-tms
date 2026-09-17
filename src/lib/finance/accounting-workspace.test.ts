import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { postedAccountingFixture } from '../../../tests/fixtures/accounting-posted';
import { FinancialControlService } from './financial-control-service';
import { FuelReadService } from './fuel-read-service';
import { BankLedgerService } from './bank-ledger-service';
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
    const fuel = await fuelService.overview(context); const fuel2 = await fuelService.overview(context,2);
    assert.equal(fuel.events,698); assert.equal(fuel.trucks,50); assert.equal(fuel.netExpenseMinor,'40955325'); assert.equal(fuel.adjustmentsMinor,'-2859');
    assert.equal(fuel.products.TRUCK_DIESEL.amountMinor,'38582162'); assert.equal(fuel.products.REEFER_FUEL.amountMinor,'1021818'); assert.equal(fuel.products.DEF.amountMinor,'1354204');
    assert.equal([...fuel.byTruck.rows,...fuel2.byTruck.rows].reduce((sum,row)=>sum+BigInt(row.amountMinor),BigInt(0)),BigInt(40958184));
    assert.ok([...fuel.byTruck.rows,...fuel2.byTruck.rows].some(row=>row.unitNumber==='8558' && row.status==='INACTIVE'));
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
  } finally { await fixture.cleanup(); }
});
