import { expect, test } from 'playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { postedAccountingFixture } from '../fixtures/accounting-posted';

test('Accounting URL navigation, protected Fuel, review queues and responsive layouts', async ({ page }) => {
  test.setTimeout(180000);
  const fixture = await postedAccountingFixture();
  try {
    const token = randomBytes(32).toString('base64url');
    await prisma.emailSignInToken.create({data:{userId:fixture.owner.id,email:fixture.owner.email,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+900000)}});
    await page.goto(`/login/email/verify#token=${token}`);
    await expect.poll(()=>new URL(page.url()).pathname).toBe('/tasks');
    await page.setViewportSize({width:1440,height:1000});
    const overviewRequests: string[] = [];
    page.on('request',request=>{ if(new URL(request.url()).pathname.startsWith('/api/finance/')) overviewRequests.push(new URL(request.url()).pathname); });
    await page.goto('/accounting');
    await expect(page.getByText('Recorded income',{exact:true}).locator('..')).toContainText('$0.00');
    await expect(page.getByText('Net expenses',{exact:true}).locator('..')).toContainText('$409,553.25');
    await expect(page.getByText(/Expense credits/)).toContainText('$-28.59');
    await expect(page.getByText('5 / 5 expected payments settled')).toBeVisible();
    expect([...new Set(overviewRequests)].sort()).toEqual(['/api/finance/group','/api/finance/overview']);
    await page.goto('/accounting?view=invalid');
    await expect(page.getByText('Recorded income',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByText('5 / 5 expected payments settled')).toBeVisible();
    const navigation = page.getByRole('navigation',{name:'Accounting sections',exact:true});
    await expect(navigation.getByRole('button')).toHaveText(['Overview','Audit Center','Transactions','Fuel','Statements','Settings']);
    await navigation.getByRole('button',{name:'Fuel',exact:true}).click();
    await expect(page).toHaveURL(/view=fuel/);
    await expect(page.getByText('Canonical Trucks',{exact:true}).locator('..')).toContainText('50');
    await page.getByRole('navigation',{name:'Fuel sections'}).getByRole('button',{name:'By Truck'}).click();
    await expect(page.getByText('Page 1 · 50 Trucks')).toBeVisible();
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.getByText('Page 2 · 50 Trucks')).toBeVisible();
    await page.goBack(); await expect(page.getByText('Page 1 · 50 Trucks')).toBeVisible();
    await page.goForward(); await expect(page.getByText('Page 2 · 50 Trucks')).toBeVisible();
    const invoices = await prisma.pilotProviderInvoice.findMany({where:{operatingGroupId:fixture.context.operatingGroupId},orderBy:{invoiceNumber:'asc'}});
    await page.goto(`/accounting?view=fuel&section=invoices&invoice=${invoices[0].id}`);
    await expect(page.getByRole('heading',{name:invoices[0].invoiceNumber,exact:true})).toBeVisible();
    await page.getByRole('button',{name:new RegExp(`Invoice ${invoices[1].invoiceNumber}`)}).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading',{name:invoices[1].invoiceNumber,exact:true})).toBeVisible();
    await page.goto('/accounting?view=statements&archive=documents');
    await expect(page.getByRole('heading',{name:'Statement documents'})).toBeVisible();
    const reconciliation = {
      coverage:{start:'2026-04-22',end:'2026-08-02'},
      summary:{count:1,pilotActualMinor:'10000',expectedMinor:'10000',statementMinor:'11509',differenceMinor:'1509',outsideCoverageStatementMinor:'0',comparablePilotMinor:'10000',reeferExcludedMinor:'500',providerCreditExcludedMinor:'-2859',historicalPostedDifferences:1},
      byStatus:Object.fromEntries(['MATCHED','UNDER_DEDUCTED','OVER_DEDUCTED','MISSING_DEDUCTION','STATEMENT_ONLY','TIMING_DIFFERENCE','NO_PILOT_DATA_IMPORTED','NEEDS_COMPANY_HISTORY','NEEDS_TRUCK_MAPPING','NEEDS_RECIPIENT_MAPPING','NEEDS_POLICY','NEEDS_REVIEW'].map(status=>[status,{count:status==='TIMING_DIFFERENCE'?1:0,pilotActualMinor:status==='TIMING_DIFFERENCE'?'10000':'0',expectedMinor:status==='TIMING_DIFFERENCE'?'10000':'0',statementMinor:status==='TIMING_DIFFERENCE'?'11509':'0',differenceMinor:status==='TIMING_DIFFERENCE'?'1509':'0'}])),
      byCompany:[],total:1,page:1,pageSize:50,
      rows:[{key:'pilot:timing',status:'TIMING_DIFFERENCE',companyId:fixture.company.id,companyName:fixture.company.name,pid:'30',purchaseDate:'2026-04-22',statementPeriod:'2026-07-01–2026-07-07',truckId:'truck',truckUnit:'024',recipientId:'contractor',recipientName:'Synthetic Contractor',responsibility:'RECIPIENT',pilotActualMinor:'10000',pilotRetailMinor:'12000',pilotSavingsMinor:'2000',expectedMinor:'10000',statementMinor:'11509',differenceMinor:'1509',observedAmountDeltaMinor:'1509',retainedDiscountMinor:'0',policyId:'policy',policyLabel:'FULL_PASS_THROUGH · 0% retained',historicalCompanyId:fixture.company.id,postedCompanyId:'posted',postedCompanyName:'Posted Company',historyDiffersFromPosted:true,products:['TRUCK_DIESEL','DEF'],gallons:'20.00',matchMethod:'REFERENCE',pilotInvoiceNumber:'PILOT-1',pilotEvidence:{eventId:'event',invoiceId:'invoice',invoiceNumber:'PILOT-1',transactionId:'transaction'},statementEvidence:{lineIds:['line-a','line-b'],versionId:'version',pid:'30',statementNumber:'STMT-30',description:'Fuel recovery',reference:'APR22-PID30'}}]
    };
    await page.route('**/api/finance/fuel-reconciliation**',async route=>{
      const requestUrl=new URL(route.request().url());
      if(route.request().method()==='POST') return route.fulfill({status:201,json:{id:'created-policy'}});
      if(requestUrl.searchParams.get('view')==='policies') return route.fulfill({json:[]});
      return route.fulfill({json:reconciliation});
    });
    await page.goto('/accounting?view=statements&archive=reconciliation');
    await expect(page.getByText('Comparable Diesel + DEF')).toBeVisible();
    await expect(page.getByText('$15.09',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('TIMING DIFFERENCE',{exact:true}).first()).toBeVisible();
    await page.getByText('Evidence and calculation').click();
    await expect(page.getByText(/invoice PILOT-1/)).toBeVisible();
    await expect(page.getByText(/PID 30/)).toBeVisible();
    await page.getByRole('button',{name:'Policies'}).click();
    await expect(page.getByRole('heading',{name:'Add effective-dated fuel deduction policy'})).toBeVisible();
    await expect(page.getByText(/never post expenses/)).toBeVisible();
    await page.unroute('**/api/finance/fuel-reconciliation**');
    await page.route('**/api/finance/overview',async route=>{
      const response = await route.fetch(); const body = await response.json();
      // Legacy diagnostics do not create an empty actionable queue.
      body.exceptions.uncategorizedTransactions = 1;
      await route.fulfill({json:body});
    });
    await navigation.getByRole('button',{name:'Audit Center'}).click();
    await expect(page.getByText('All checks clear.')).toBeVisible();
    await page.unroute('**/api/finance/overview');
    await page.goto('/accounting?view=transactions&queue=uncategorizedExpenses');
    await expect(page.getByText('Page 1 · 0 transactions')).toBeVisible();
    await page.goto('/accounting?view=transactions');
    await expect(page.getByText('Page 1 · 699 transactions')).toBeVisible();
    const posted = page.locator('article').filter({has:page.getByText(/Pilot fuel purchase/)}).first();
    await expect(posted.getByRole('button',{name:'Delete',exact:true})).toHaveCount(0);
    await expect(posted.getByRole('button',{name:'Save allocations'})).toHaveCount(0);
    await posted.getByText('Allocations, source and evidence').click();
    await expect(posted.getByText(/Evidence:/).first()).toBeVisible();
    await expect(posted.getByRole('link',{name:/Pilot invoice/})).toBeVisible();
    await page.goto('/accounting/banking?view=transactions');
    await expect(page.getByText('0 matching bank movements')).toBeVisible();
    await page.getByLabel('Bank view',{exact:true}).selectOption('all');
    await expect(page.getByText('5 matching bank movements')).toBeVisible();
    await expect(page.getByRole('link',{name:'Pilot invoice 790734384',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save classification'})).toHaveCount(0);
    await expect(page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Bank Transactions',exact:true})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Driver Settlements',exact:true})).toBeVisible();
    let releaseOld!: () => void;
    let oldStarted!: () => void;
    const oldSeen = new Promise<void>(resolve=>{oldStarted=resolve;});
    const oldRelease = new Promise<void>(resolve=>{releaseOld=resolve;});
    await page.route('**/api/finance/bank/transactions?**',async route=>{
      if(new URL(route.request().url()).searchParams.get('q') !== 'delayed') return route.continue();
      oldStarted(); await oldRelease;
      await route.fulfill({json:{rows:[],total:123,page:1,pageSize:50}}).catch(()=>{});
    });
    await page.getByLabel('Search bank transactions').fill('delayed'); await oldSeen;
    await page.getByLabel('Search bank transactions').fill('not present');
    await expect(page.getByText('0 matching bank movements')).toBeVisible();
    releaseOld(); await page.waitForLoadState('networkidle');
    await expect(page.getByText('0 matching bank movements')).toBeVisible();
    await page.unroute('**/api/finance/bank/transactions?**');
    for (const width of [1440,820,390]) {
      await page.setViewportSize({width,height:900});
      await page.goto('/accounting?view=settings&section=fuel-rules');
      await expect(page.getByRole('heading',{name:'Pilot Product Mappings'})).toBeVisible();
      if(width<1280) { await expect(page.getByLabel('Accounting section',{exact:true})).toBeVisible(); await page.getByLabel('Accounting section',{exact:true}).selectOption('overview'); }
      else await page.getByRole('navigation',{name:'Accounting sections',exact:true}).getByRole('button',{name:'Overview'}).click();
      await expect(page.getByText('Recorded income',{exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/accounting-${width}.png`,fullPage:true});
    }
    expect(await prisma.financialTransaction.count({where:{operatingGroupId:fixture.context.operatingGroupId}})).toBe(699);
    expect(await prisma.financialExpectationBankMatch.count({where:{operatingGroupId:fixture.context.operatingGroupId}})).toBe(5);
  } finally { await fixture.cleanup(); }
});
