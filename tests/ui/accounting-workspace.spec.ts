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
    // The intercepted API payload intentionally exercises nullable source-side fields.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reconciliation: any = {
      coverage:{start:'2026-04-22',end:'2026-08-02',pilotRanges:[{start:'2026-04-22',end:'2026-08-02'}]},
      completeness:{
        allImported:{pilot:{count:7,gallonsHundredths:'14000',retailMinor:'84000',netMinor:'70000',missingRetailCount:0},quickManage:{count:7,sourceRecordCount:8,gallonsHundredths:'14000',retailMinor:'84000',deductedMinor:'80563',missingRetailCount:0}},
        comparable:{pilot:{count:6,gallonsHundredths:'12000',retailMinor:'72000',netMinor:'60000',missingRetailCount:0},quickManage:{count:6,sourceRecordCount:7,gallonsHundredths:'12000',retailMinor:'72000',deductedMinor:'69054',missingRetailCount:0}},
        matching:{autoMatched:5,manualMatched:1,pilotUnmatched:1,quickManageUnmatched:1,sourceCoverageGaps:1,needsReview:2,outsideComparable:1},
        conservation:{pilot:{countDifference:0,gallonsDifferenceHundredths:'0',retailDifferenceMinor:'0',dollarDifferenceMinor:'0'},quickManage:{countDifference:0,gallonsDifferenceHundredths:'0',retailDifferenceMinor:'0',dollarDifferenceMinor:'0'}},
        orphanRecords:0,orphanPilotRecords:0,orphanQuickManageRecords:0,orphanActiveManualMatches:0,duplicateConsumedEvidence:0,
        missingPilotCoverage:[{start:'2026-01-05',end:'2026-06-28'}],missingQuickManageCoverage:[{companyId:fixture.company.id,companyName:'1-9 Transportation Inc',pid:null,date:'2026-07-25',reason:'MISSING_QUICKMANAGE_COVERAGE'}],
      },
      summary:{count:1,pilotActualMinor:'10000',expectedMinor:'10000',statementMinor:'11509',comparableStatementMinor:'11509',rawStatementDeductionMinor:'15000',rawFuelStatementMinor:'11509',unsupportedFuelStatementCount:0,unsupportedFuelStatementMinor:'0',differenceMinor:'1509',outsideCoverageStatementMinor:'0',comparablePilotMinor:'10000',reeferExcludedMinor:'500',providerCreditExcludedMinor:'-2859',historicalPostedDifferences:1},
      byStatus:Object.fromEntries(['MATCHED','UNDER_DEDUCTED','OVER_DEDUCTED','MISSING_DEDUCTION','STATEMENT_ONLY','TIMING_DIFFERENCE','NO_PILOT_DATA_IMPORTED','NEEDS_COMPANY_HISTORY','NEEDS_TRUCK_MAPPING','NEEDS_RECIPIENT_MAPPING','NEEDS_RECIPIENT_REVIEW','PRODUCT_CLASSIFICATION_REVIEW','NEEDS_POLICY','NEEDS_REVIEW'].map(status=>[status,{count:status==='TIMING_DIFFERENCE'?1:0,pilotActualMinor:status==='TIMING_DIFFERENCE'?'10000':'0',expectedMinor:status==='TIMING_DIFFERENCE'?'10000':'0',statementMinor:status==='TIMING_DIFFERENCE'?'11509':'0',differenceMinor:status==='TIMING_DIFFERENCE'?'1509':'0'}])),
      controls:[] as Array<{key:string;label:string;count:number;filter:{status?:string;history?:string};amounts:Array<{amountMinor:string;amountBasis:string;amountLabel:string}>}>,
      byCompany:[],total:1,page:1,pageSize:50,
      rows:[{key:'pilot:timing',status:'TIMING_DIFFERENCE',companyId:fixture.company.id,companyName:fixture.company.name,pid:'30',purchaseDate:'2026-04-22',statementPeriod:'2026-07-01–2026-07-07',truckId:'truck',truckUnit:'024',recipientId:'contractor',recipientName:'Synthetic Contractor',responsibility:'RECIPIENT',pilotEventId:'event',pilotInvoiceId:'invoice',pilotActualMinor:'10000',pilotRetailMinor:'12000',pilotSavingsMinor:'2000',expectedMinor:'10000',statementMinor:'11509',differenceMinor:'1509',observedAmountDeltaMinor:'1509',retainedDiscountMinor:'0',policyId:'policy',policyLabel:'FULL_PASS_THROUGH · 0% retained',historicalCompanyId:fixture.company.id,postedCompanyId:'posted',postedCompanyName:'Posted Company',currentCompanyId:'current',currentCompanyName:'Current Company',historyDiffersFromPosted:true,products:['TRUCK_DIESEL','DEF'],gallons:'20.00',pilotCardLastFour:'1234',pilotLocationNumber:'1194',pilotCity:'Phoenix',pilotState:'AZ',matchMethod:'REFERENCE',statementTruckUnit:'024',statementRecipientId:'contractor',statementRecipientName:'Synthetic Contractor',statementDate:'2026-04-22T12:00:00Z',statementCardLastFour:'1234',statementLocationNumber:'1194',statementCity:'Phoenix',statementState:'AZ',statementGallons:'20.00',statementRetailMinor:'12000',statementProducts:['TRUCK_DIESEL','DEF'],productClassification:'SAME',manualMatch:null,canonicalIdentityLink:{linkId:'link-94',provider:'QUICKMANAGE',providerTruckId:'e8d2c3c4-45b0-4f1c-ab84-72cb893f8360',sourceUnit:'3891',sourceVin:null,sourceCompanyId:fixture.company.id,sourceCompanyName:'Source Company',canonicalTruckId:'canonical-truck',canonicalUnit:'3891',canonicalVin:'1M8GDM9AXKP042788',canonicalCompanyId:fixture.company.id,canonicalCompanyName:'Current Company',actor:fixture.owner.displayName,createdAt:'2026-09-24T12:00:00.000Z',reason:'Repeated immutable source evidence',sourceReference:'Two exact Pilot and QuickManage transactions',evidenceReferenceCount:2},pilotInvoiceNumber:'PILOT-1',pilotEvidence:{eventId:'event',invoiceId:'invoice',invoiceNumber:'PILOT-1',transactionId:'transaction'},statementEvidence:{groupLineId:'line-a',lineIds:['line-a','line-b'],versionId:'version',pid:'30',statementNumber:'STMT-30',description:'Fuel recovery',reference:'APR22-PID30'}}]
    };
    reconciliation.rows.push(
      {...reconciliation.rows[0],key:'pilot:weekend',status:'MATCHED',truckUnit:'7455',purchaseDate:'2026-07-12',differenceMinor:'0',historyDiffersFromPosted:false,matchMethod:'PILOT_SUNDAY_QUICKMANAGE_SATURDAY'},
      {...reconciliation.rows[0],key:'pilot:historical-routing',status:'MATCHED',truckUnit:'7906',statementTruckUnit:'8154',statementRecipientName:'8154 Saas LLC',purchaseDate:'2026-07-04',differenceMinor:'0',historyDiffersFromPosted:false,matchMethod:'HISTORICAL_CROSS_RECIPIENT_RECOVERED'},
      {...reconciliation.rows[0],key:'pilot:recipient',status:'NEEDS_RECIPIENT_REVIEW',truckUnit:'7906',purchaseDate:'2026-07-04',differenceMinor:'0',historyDiffersFromPosted:false,matchMethod:'CROSS_RECIPIENT_STRUCTURED_IDENTITY'},
      {...reconciliation.rows[0],key:'pilot:diesel-reefer',status:'MATCHED',truckUnit:'8479',products:['REEFER_FUEL'],statementProducts:['TRUCK_DIESEL'],productClassification:'DIESEL_REEFER_DIFFERENCE',purchaseDate:'2026-07-12',expectedMinor:'10000',statementMinor:'10001',differenceMinor:'1',historyDiffersFromPosted:false,matchMethod:'DIESEL_REEFER_CLASSIFICATION_ACCEPTED'},
      {...reconciliation.rows[0],key:'pilot:product',status:'PRODUCT_CLASSIFICATION_REVIEW',truckUnit:'8479',purchaseDate:'2026-07-12',differenceMinor:'0',historyDiffersFromPosted:false,matchMethod:'PRODUCT_CLASSIFICATION_CONFLICT'},
      {...reconciliation.rows[0],key:'pilot:unmatched',status:'PILOT_UNMATCHED',pilotEventId:'pilot-unmatched',truckUnit:'042',purchaseDate:'2026-07-26',pilotActualMinor:'40392',pilotRetailMinor:'50500',pilotSavingsMinor:'10108',products:['TRUCK_DIESEL'],gallons:'80.17',expectedMinor:'41402',statementMinor:'0',differenceMinor:null,historyDiffersFromPosted:false,statementEvidence:null,statementTruckUnit:null,statementRecipientId:null,statementRecipientName:null,statementProducts:[],statementRetailMinor:null,statementGallons:'0',matchMethod:null},
      {...reconciliation.rows[0],key:'statement:unmatched',status:'QM_UNMATCHED',pilotEventId:null,pilotInvoiceId:null,pilotEvidence:null,pilotActualMinor:'0',pilotRetailMinor:null,pilotSavingsMinor:null,products:[],gallons:'0.00',pid:'2026-30',statementMinor:'41402',differenceMinor:null,historyDiffersFromPosted:false,statementEvidence:{groupLineId:'line-qm-unmatched',lineIds:['line-qm-unmatched'],versionId:'version-qm',pid:'2026-30',statementNumber:'13',description:'Fuel deduction',reference:'QM-042'},statementTruckUnit:'042',statementRecipientName:'042 Babamurat Kurbanov',statementDate:'2026-07-25T16:34:00Z',statementGallons:'80.17',statementRetailMinor:'50500',matchMethod:null},
      {...reconciliation.rows[0],key:'pilot:manual',status:'MATCHED',pilotEventId:'pilot-manual',truckUnit:'900',purchaseDate:'2026-07-20',differenceMinor:'0',historyDiffersFromPosted:false,matchMethod:'MANUAL_OWNER_MATCH',manualMatch:{id:'manual-match-1',reason:'OWNER confirmed the immutable source identity.',actor:fixture.owner.displayName,createdAt:'2026-09-24T12:30:00.000Z'}},
    );
    reconciliation.total = reconciliation.rows.length;
    const controlLabels:Record<string,string>={MATCHED:'Matched',UNDER_DEDUCTED:'Under-deduction',OVER_DEDUCTED:'Over-deduction',MISSING_DEDUCTION:'Missing deduction',STATEMENT_ONLY:'Statement-only within Pilot coverage',PILOT_UNMATCHED:'Pilot unmatched',QM_UNMATCHED:'QM unmatched',SOURCE_COVERAGE_GAP:'Source coverage gap',TIMING_DIFFERENCE:'Timing difference',NO_PILOT_DATA_IMPORTED:'No Pilot data imported',NEEDS_COMPANY_HISTORY:'Needs Company history',NEEDS_TRUCK_MAPPING:'Needs Truck mapping',NEEDS_RECIPIENT_MAPPING:'Needs recipient mapping',NEEDS_RECIPIENT_REVIEW:'Needs recipient routing review',PRODUCT_CLASSIFICATION_REVIEW:'Needs fuel product review',NEEDS_POLICY:'Needs policy',NEEDS_REVIEW:'Needs review'};
    const controlStatuses=Object.keys(controlLabels);
    reconciliation.controls=controlStatuses.map(status=>{
      const rows=reconciliation.rows.filter((row:{status:string})=>row.status===status);
      const total=(field:'pilotActualMinor'|'expectedMinor'|'statementMinor'|'differenceMinor')=>rows.reduce((sum:bigint,row:Record<string,string|null>)=>sum+BigInt(row[field]??'0'),BigInt(0));
      const semantic=status==='MISSING_DEDUCTION'?{amountMinor:(total('differenceMinor')*-BigInt(1)).toString(),amountBasis:'DISCREPANCY',amountLabel:'potential missing'}:status==='STATEMENT_ONLY'||status==='NEEDS_TRUCK_MAPPING'||status==='NO_PILOT_DATA_IMPORTED'?{amountMinor:total('statementMinor').toString(),amountBasis:'STATEMENT',amountLabel:status==='NO_PILOT_DATA_IMPORTED'?'outside Pilot coverage':'statement affected'}:{amountMinor:total('pilotActualMinor').toString(),amountBasis:'PILOT',amountLabel:'Pilot affected'};
      return {key:status,label:controlLabels[status],count:rows.length,filter:{status},amounts:[semantic]};
    });
    const historyRows=reconciliation.rows.filter((row:{historyDiffersFromPosted:boolean})=>row.historyDiffersFromPosted);
    reconciliation.controls.push({key:'HISTORICAL_POSTED_MISMATCH',label:'Historical ≠ posted Company',count:historyRows.length,filter:{history:'posted-mismatch'},amounts:[{amountMinor:historyRows.reduce((sum:bigint,row:{pilotActualMinor:string})=>sum+BigInt(row.pilotActualMinor),BigInt(0)).toString(),amountBasis:'PILOT',amountLabel:'Pilot affected'}]});
    const policy = {id:'revision-policy',companyId:fixture.company.id,truckId:'truck',providerRecipientId:'contractor',responsibility:'RECIPIENT',discountTreatment:'COMPANY_RETENTION',companyRetentionBasisPoints:1000,effectiveFrom:'2026-07-01T00:00:00.000Z',effectiveTo:'2026-07-08T00:00:00.000Z',sourceReference:'Reviewed agreement',reason:'Initial range',revision:1,company:{name:fixture.company.name},truck:{unitNumber:'024'},approvedBy:{displayName:fixture.owner.displayName},revisions:[] as Array<Record<string,unknown>>};
    let manualMatchRequest:Record<string,unknown>|null=null, manualUnmatchRequest:Record<string,unknown>|null=null;
    await page.route('**/api/finance/fuel-reconciliation**',async route=>{
      const requestUrl=new URL(route.request().url());
      if(route.request().method()==='POST') { const body=route.request().postDataJSON(); if(body.action==='MANUAL_MATCH') manualMatchRequest=body; return route.fulfill({status:201,json:{id:body.action==='MANUAL_MATCH'?'manual-created':'created-policy'}}); }
      if(route.request().method()==='PUT') return route.fulfill({json:{policyId:policy.id,expectedRevision:policy.revision,current:{effectiveFrom:'2026-07-01',effectiveTo:'2026-07-08',coveredRows:3,pilotMinor:'120000'},proposed:{effectiveFrom:'2026-07-01',effectiveTo:'2026-07-09',coveredRows:4,pilotMinor:'165000'},newlyCovered:{rows:1,pilotMinor:'45000',dates:['2026-07-08']},evidenceReferences:[{pilotEventId:'event-1',purchaseDate:'2026-07-08',supportFrom:'2026-07-08',supportTo:'2026-07-09',statementVersionId:'version-1',statementLineIds:['line-1']}]}});
      if(route.request().method()==='PATCH') { const body=route.request().postDataJSON(); if(body.action==='MANUAL_UNMATCH') { manualUnmatchRequest=body; return route.fulfill({json:{id:body.matchId}}); } policy.revision=2; policy.effectiveTo='2026-07-09T00:00:00.000Z'; policy.revisions=[{id:'revision-2',revision:2,before:{effectiveFrom:'2026-07-01',effectiveTo:'2026-07-08'},after:{effectiveFrom:'2026-07-01',effectiveTo:'2026-07-09'},reason:'Extended effective range based on additional corroborated Pilot ↔ QuickManage fuel transactions.',evidenceReferences:[{pilotEventId:'event-1'}],changedAt:'2026-09-23T12:00:00.000Z',actor:{displayName:fixture.owner.displayName}}]; return route.fulfill({json:policy}); }
      if(requestUrl.searchParams.get('view')==='policies') return route.fulfill({json:[policy]});
      const rows=reconciliation.rows.filter((row:{status:string;historyDiffersFromPosted:boolean;manualMatch:unknown;pilotEventId:string|null;statementEvidence:unknown})=>(!requestUrl.searchParams.get('status')||row.status===requestUrl.searchParams.get('status'))&&(!requestUrl.searchParams.get('history')||row.historyDiffersFromPosted)&&(!requestUrl.searchParams.get('match')||requestUrl.searchParams.get('match')==='manual'&&!!row.manualMatch||requestUrl.searchParams.get('match')==='auto'&&!!row.pilotEventId&&!!row.statementEvidence&&!row.manualMatch));
      return route.fulfill({json:{...reconciliation,rows,total:rows.length}});
    });
    await page.goto('/accounting?view=statements&archive=reconciliation');
    await expect(page.getByText('Comparable Pilot Diesel + Reefer + DEF')).toBeVisible();
    await expect(page.getByText('$15.09',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('TIMING DIFFERENCE',{exact:true}).first()).toBeVisible();
    await expect(page.getByRole('heading',{name:'FUEL SOURCE COMPLETENESS'})).toBeVisible();
    await expect(page.getByRole('link',{name:/Orphan records/})).toContainText('0');
    await expect(page.getByRole('link',{name:/Duplicate consumption/})).toContainText('0');
    const unmatchedControl=page.getByRole('link',{name:'Pilot unmatched: 1 records'});
    await expect(unmatchedControl).toContainText('$403.92');
    await page.getByRole('button',{name:'Select Pilot'}).click();
    await page.getByRole('button',{name:'Select QM'}).click();
    const manualForm=page.locator('form').filter({has:page.getByRole('heading',{name:'MANUAL MATCH'})});
    await expect(manualForm).toContainText('80.17 gal');
    await manualForm.getByLabel('OWNER reason').fill('OWNER confirmed these immutable records are the same purchase.');
    await manualForm.getByLabel(/I confirm these are the same fuel purchase/).check();
    await manualForm.getByRole('button',{name:'Save audited manual match'}).click();
    await expect.poll(()=>manualMatchRequest).toMatchObject({action:'MANUAL_MATCH',pilotEventId:'pilot-unmatched',archiveLineId:'line-qm-unmatched'});
    const manualRow=page.getByRole('row').filter({hasText:'900'}).last();
    await manualRow.getByText('Evidence and calculation').click();
    await expect(manualRow.getByText('MANUAL MATCH AUDIT')).toBeVisible();
    await manualRow.getByPlaceholder('Audited reason to undo this match').fill('OWNER is returning this pairing to the review queues.');
    await manualRow.getByRole('button',{name:'Undo / unmatch'}).click();
    await expect.poll(()=>manualUnmatchRequest).toMatchObject({action:'MANUAL_UNMATCH',matchId:'manual-match-1'});
    for (const control of reconciliation.controls) {
      await page.goto('/accounting?view=statements&archive=reconciliation');
      const link=page.getByRole('link',{name:`${control.label}: ${control.count} records`});
      const href=await link.getAttribute('href'); expect(href).toBeTruthy();
      await link.click();
      const filterEntry=Object.entries(control.filter)[0];
      await expect(page).toHaveURL(new RegExp(`${filterEntry[0]}=${filterEntry[1]}`));
      await expect(page.getByRole('status')).toContainText(`${control.label} · ${control.count} matching reconciliation rows`);
      await page.reload();
      await expect(page.getByRole('status')).toContainText(`${control.label} · ${control.count} matching reconciliation rows`);
      await page.goBack(); await expect(page).toHaveURL(/\/accounting\?view=statements&archive=reconciliation$/);
      await page.goForward(); await expect(page).toHaveURL(new RegExp(`${filterEntry[0]}=${filterEntry[1]}`));
      await page.goto('/accounting?view=statements&archive=reconciliation');
      await page.goto(href!);
      await expect(page.getByRole('status')).toContainText(`${control.label} · ${control.count} matching reconciliation rows`);
    }
    await page.goto('/accounting?view=statements&archive=reconciliation');
    const recipientReviewControl=page.getByRole('link',{name:'Needs recipient routing review: 1 records'});
    await recipientReviewControl.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/status=NEEDS_RECIPIENT_REVIEW/);
    await expect(page.getByText('Page 1 · 1 rows')).toBeVisible();
    const filteredRecipientRow=page.getByRole('row').filter({hasText:'NEEDS RECIPIENT REVIEW'});
    await filteredRecipientRow.getByText('Evidence and calculation').click();
    await expect(filteredRecipientRow.getByText(/Recipient responsibility requires review/)).toBeVisible();
    await page.goto('/accounting?view=statements&archive=reconciliation');
    await page.getByRole('link',{name:'Historical ≠ posted Company: 1 records'}).click();
    await expect(page).toHaveURL(/history=posted-mismatch/);
    await expect(page.getByRole('status')).toContainText('Historical ≠ posted Company · 1 matching reconciliation rows');
    await page.goto('/accounting?view=statements&archive=reconciliation');
    const timingRow = page.getByRole('row').filter({hasText:'TIMING DIFFERENCE'}).last();
    await timingRow.getByText('Evidence and calculation').click();
    await expect(timingRow.getByText(/invoice PILOT-1/)).toBeVisible();
    await expect(timingRow.getByText(/PID 30/)).toBeVisible();
    await expect(timingRow.getByText(/Current Company Current Company/)).toBeVisible();
    const canonicalLink = timingRow.getByRole('region',{name:'Canonical identity link'});
    await expect(canonicalLink).toContainText('Canonical identity link; source evidence unchanged.');
    await expect(canonicalLink).toContainText('e8d2c3c4-45b0-4f1c-ab84-72cb893f8360');
    await expect(canonicalLink).toContainText('canonical-truck');
    await expect(canonicalLink).toContainText('Repeated immutable source evidence');
    await expect(canonicalLink).toContainText('2 evidence references');
    for (const [rowText, explanation] of [['7455','Matched the Pilot Sunday date-only row'],['NEEDS RECIPIENT REVIEW','Recipient responsibility requires review'],['PRODUCT CLASSIFICATION REVIEW','No over- or under-deduction conclusion is made']]) {
      const row = page.getByRole('row').filter({hasText:rowText}).last();
      await row.getByText('Evidence and calculation').click();
      await expect(row.getByText(new RegExp(explanation))).toBeVisible();
    }
    const historicalRouting = page.getByRole('row').filter({hasText:'8154 Saas LLC'}).last();
    await historicalRouting.getByText('Evidence and calculation').click();
    await expect(historicalRouting.getByText(/historical cross-recipient settlement accepted/)).toBeVisible();
    const dieselReefer = page.getByRole('row').filter({hasText:'Different \/ informational'}).last();
    await expect(dieselReefer.getByText('Within OWNER-approved $0.05 monetary tolerance')).toBeVisible();
    await dieselReefer.getByText('Evidence and calculation').click();
    await expect(dieselReefer.getByText(/same fuel purchase/)).toBeVisible();
    for (const viewport of [{width:1440,height:900},{width:900,height:900},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await expect(page.getByText('Comparable statement fuel in coverage')).toBeVisible();
      const layout = await page.evaluate(() => ({
        fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        overflowing: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 5)
          .map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })),
      }));
      expect(layout.fits, `${viewport.width}px overflow: ${JSON.stringify(layout.overflowing)}`).toBe(true);
    }
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole('button',{name:'Policies'}).click();
    await expect(page.getByRole('heading',{name:'Add effective-dated fuel deduction policy'})).toBeVisible();
    await expect(page.getByText(/never post expenses/)).toBeVisible();
    await page.getByRole('button',{name:'Review range revision'}).click();
    await page.getByLabel('Proposed end (exclusive)').fill('2026-07-09');
    await page.getByRole('button',{name:'Preview impact'}).click();
    await expect(page.getByLabel('Revision impact preview')).toContainText('Newly covered: 1 rows · $450.00');
    await page.getByRole('button',{name:'Save audited revision'}).click();
    await expect(page.getByText(/Revision 2 · 2026-07-01 – 2026-07-09/).first()).toBeVisible();
    await page.getByText('Revision history (1)').click();
    await expect(page.getByText(/2026-07-08 → 2026-07-01 – 2026-07-09/)).toBeVisible();
    await page.unroute('**/api/finance/fuel-reconciliation**');
    await page.route('**/api/finance/overview',async route=>{
      const response = await route.fetch(); const body = await response.json();
      // Legacy diagnostics do not create an empty actionable queue.
      body.exceptions.uncategorizedTransactions = 1;
      await route.fulfill({json:body});
    });
    await navigation.getByRole('button',{name:'Audit Center'}).click();
    await expect(page.getByText('All checks clear.')).toBeVisible();
    const fuelControls=page.locator('section').filter({has:page.getByRole('heading',{name:'Fuel deduction controls'})});
    await expect(fuelControls.getByRole('link',{name:/Missing deduction:/})).toHaveAttribute('href',/status=MISSING_DEDUCTION/);
    await expect(fuelControls.getByRole('link',{name:/Historical ≠ posted Company:/})).toHaveAttribute('href',/history=posted-mismatch/);
    await expect(fuelControls.getByRole('link',{name:/records/})).toHaveCount(12);
    for (const link of await fuelControls.getByRole('link',{name:/records/}).all()) {
      await expect(link).toHaveAttribute('href',/view=statements.*archive=reconciliation.*(status|history)=/);
    }
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
