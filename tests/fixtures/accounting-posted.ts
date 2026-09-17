import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { FinancialControlService } from '@/lib/finance/financial-control-service';
import { PilotImportService } from '@/lib/finance/pilot-import-service';
import type { FinancialAuthorization } from '@/lib/finance/financial-control-authorization';
import { pilotXlsFixture } from './pilot-xls';

/** Synthetic, disposable test data matching the protected aggregate, never Alpha data. */
export async function postedAccountingFixture() {
  const suffix = randomUUID();
  const company = await prisma.company.create({ data: { name: `Accounting fixture ${suffix}` } });
  const owner = await prisma.user.create({ data: { email: `accounting-${suffix}@example.test`, displayName: 'Accounting fixture owner', activeCompanyId: company.id, memberships: { create: { companyId: company.id, role: 'OWNER' } } } });
  const control = new FinancialControlService();
  const group = await control.createGroup(`Accounting fixture ${suffix}`, { companyId: company.id, role: 'OWNER', user: { id: owner.id, email: owner.email, displayName: owner.displayName, activeCompanyId: company.id, isActive: true } });
  const context: FinancialAuthorization = { userId: owner.id, activeCompanyId: company.id, operatingGroupId: group.id, companyIds: [company.id], role: 'OWNER' };
  const source = await control.createSource({ name: 'Pilot fixture', type: 'FUEL_CARD', companyId: company.id }, context);
  const category = await prisma.financialCategory.findFirstOrThrow({ where: { operatingGroupId: group.id, name: 'Fuel' } });
  const truckIds: string[] = [];
  for (let i=0;i<50;i++) truckIds.push((await prisma.truck.create({ data: { companyId: company.id, unitNumber: String(8509+i), unitNumberNormalized: String(8509+i) } })).id);
  const providerAccountHash = createHash('sha256').update('123456789').digest('hex');
  await prisma.pilotProductMapping.createMany({ data: [ ['020','TRUCK_DIESEL'],['033','REEFER_FUEL'],['140','DEF'],['ADJUSTMENT:FREIGHT_RATE','UNKNOWN_PRODUCT'] ].map(([productCode, productType]) => ({ operatingGroupId: group.id, providerAccountHash, productCode, productType: productType as 'TRUCK_DIESEL' | 'REEFER_FUEL' | 'DEF' | 'UNKNOWN_PRODUCT', categoryId: category.id, approvedByUserId: owner.id })) });
  const bankAccount = await prisma.bankAccount.create({ data: { companyId: company.id, provider: 'PLAID', externalConnectionId: suffix } });
  const counts = [95,112,137,170,184], totals = [5148161,5953073,7844061,10277770,11732260], numbers = ['787303394','788363801','789500735','790734384','791805751'];
  const share = (total: number, count: number, index: number) => Math.floor(total/count) + (index < total%count ? 1 : 0);
  let start = 0;
  const importer = new PilotImportService();
  const banks: string[] = [];
  try {
    for (let inv=0;inv<5;inv++) {
      const indices = Array.from({ length: counts[inv] }, (_,i) => start+i);
      const extra = (index: number) => (index < 305 ? share(1354204,305,index) : 0) + (index >= 595 ? share(1021818,103,index-595) : 0);
      const dieselTotal = totals[inv] + (inv === 0 ? 2859 : 0) - indices.reduce((sum,index) => sum+extra(index),0);
      const dieselIndices = indices.filter(index => index < 674);
      const lines = indices.flatMap(index => {
        const values: [string,number][] = [];
        if (index < 674) values.push(['020',share(dieselTotal,dieselIndices.length,dieselIndices.indexOf(index))]);
        if (index >= 595) values.push(['033',share(1021818,103,index-595)]);
        if (index < 305) values.push(['140',share(1354204,305,index)]);
        return values.map(([code,amount]) => ['1111222233334444',String(8509+index%50),'0099','Dallas                  TX',index === start ? 'TICKET-1' : `T-${index}`,index === start ? 'AUTH-1' : `A-${index}`,'Driver One','08/18',123456,code,1,amount/100,amount/100,0,0,0,0,0,amount/100,amount/100]);
      });
      const first = lines.shift()!;
      const bytes = pilotXlsFixture({ invoiceNumber: numbers[inv], unitNumber: String(first[1]), amount: Number(first[18]), quantity: 1, unitPrice: Number(first[18]), total: totals[inv]/100, ...(inv === 0 ? { adjustment: -28.59 } : {}), rowsBeforeTotal: lines });
      const invoice = await importer.createImport(bytes, { originalFilename: `${numbers[inv]}.xls`,displayFilename:`${numbers[inv]}.xls`,mimeType:'application/vnd.ms-excel',byteSize:bytes.length,storageKey:randomUUID(),checksumSha256:createHash('sha256').update(bytes).digest('hex') },source.id,context);
      if (invoice.status !== 'READY_TO_POST') throw new Error(`Fixture import not ready: ${JSON.stringify(invoice.issues)}`);
      const posted = await importer.postInvoice(String(invoice.id),context);
      const bank = await prisma.bankTransaction.create({ data: { bankAccountId: bankAccount.id, companyId: company.id, providerTransactionId: `${suffix}-${inv}`, date: new Date('2026-08-26'), amount: totals[inv]/100, amountMinor: BigInt(totals[inv]), direction:'OUTFLOW',name:`Pilot invoice ${numbers[inv]}`,merchantName:'Pilot Flying J', classification:{create:{}} } });
      banks.push(bank.id);
      await control.matchExpectationToBank(String(posted.expectationId),{bankTransactionId:bank.id},context);
      start += counts[inv];
    }
    await prisma.truck.update({ where: { id: truckIds[49] }, data: { status:'INACTIVE' } });
    return { owner,company,context,category,banks,cleanup };
  } catch (error) { await cleanup(); throw error; }
  async function cleanup() {
    await prisma.financialExpectationBankMatch.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.financialAuditEvent.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.financialAllocation.deleteMany({where:{transaction:{operatingGroupId:group.id}}});
    await prisma.financialTransactionEvidence.deleteMany({where:{transaction:{operatingGroupId:group.id}}});
    await prisma.pilotImportIssue.deleteMany({where:{invoice:{operatingGroupId:group.id}}});
    await prisma.pilotFuelProductLine.deleteMany({where:{invoice:{operatingGroupId:group.id}}});
    await prisma.pilotFuelingEvent.deleteMany({where:{invoice:{operatingGroupId:group.id}}});
    await prisma.pilotInvoiceAdjustment.deleteMany({where:{invoice:{operatingGroupId:group.id}}});
    await prisma.pilotInvoiceDocument.deleteMany({where:{invoice:{operatingGroupId:group.id}}});
    await prisma.pilotProviderInvoice.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.financialTransaction.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.financialExpectation.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.financialImportRecord.deleteMany({where:{statement:{operatingGroupId:group.id}}});
    await prisma.financialStatement.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.pilotProductMapping.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.financialSource.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.bankTransactionClassification.deleteMany({where:{bankTransaction:{bankAccountId:bankAccount.id}}});
    await prisma.financialCategory.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.bankTransaction.deleteMany({where:{bankAccountId:bankAccount.id}});
    await prisma.bankAccount.delete({where:{id:bankAccount.id}});
    await prisma.operatingGroupMembership.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.operatingGroupCompany.deleteMany({where:{operatingGroupId:group.id}});
    await prisma.operatingGroup.delete({where:{id:group.id}});
    await prisma.truck.deleteMany({where:{companyId:company.id}});
    await prisma.user.delete({where:{id:owner.id}});
    await prisma.company.delete({where:{id:company.id}});
  }
}
