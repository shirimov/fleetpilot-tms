import {expect,test} from 'playwright/test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {prisma} from '@/lib/prisma';
import {provisionSourceCompanies} from '../../src/lib/fleet/qm-driver-company.mjs';
import {postgresStore} from '../../src/lib/fleet/qm-driver-store.mjs';
import {importDrivers,fingerprint} from '../../src/lib/fleet/qm-driver-import.mjs';
import {fixture} from '../../scripts/qm-driver-fixture.mjs';

test('synthetic OWNER login reads imported pool and MEMBER is denied',async({page,browser})=>{
 test.setTimeout(60000);
 const url=new URL(process.env.DATABASE_URL!);
 expect(url.hostname).toBe('127.0.0.1');expect(url.port).toBe('55439');
 expect(url.pathname).toBe('/fleetpilot_driver_import_test_acceptance');
 const pool=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:15000});
 try {
  const owner=await prisma.user.create({data:{email:`driver-ui-${randomUUID()}@example.test`,displayName:'Synthetic Driver Owner'}});
  const group=await prisma.operatingGroup.create({data:{name:`Synthetic Driver UI ${randomUUID()}`,memberships:{create:{userId:owner.id,role:'OWNER'}}}});
  const scope={provider:'QUICKMANAGE',accountKey:`synthetic-ui-${randomUUID()}`,operatingGroupId:group.id};
  const plan={version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),existingMappings:[],companies:[{providerCompanyId:'synthetic-ui-source',companyId:randomUUID(),membershipId:randomUUID(),companyName:`Synthetic UI Carrier ${randomUUID()}`}]};
  const store=postgresStore(pool);
  const provision=await provisionSourceCompanies(store,{plan,reviewedPlanSha256:fingerprint(plan),actorUserId:owner.id,mode:'CREATE'});
  await prisma.user.update({where:{id:owner.id},data:{activeCompanyId:plan.companies[0].companyId}});
  const row=fixture();row.company_id='synthetic-ui-source';row.qm_driver_id=randomUUID();row.full_name='Synthetic Browser Driver';row.hire_date='2026-01-02';
  await importDrivers(store,{rows:[row],scope,mappings:provision.mappings,actorUserId:owner.id,evidenceSha256:plan.evidenceSha256});
  async function issueToken(user:{id:string;email:string}) {
   const token=randomBytes(32).toString('base64url');
   await prisma.emailSignInToken.create({data:{userId:user.id,email:user.email,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
   return token;
  }
  await page.goto(`/login/email/verify#token=${await issueToken(owner)}`);
  await expect.poll(()=>new URL(page.url()).pathname).toBe('/tasks');
  const companyResponse=await page.request.get('/api/auth/company');
  expect(companyResponse.status()).toBe(200);
  const companyContext=await companyResponse.json();
  expect(companyContext.activeCompanyId).toBe(plan.companies[0].companyId);
  expect(companyContext.companies).toEqual(expect.arrayContaining([expect.objectContaining({id:plan.companies[0].companyId,role:'OWNER'})]));
  await page.goto('/drivers/pool');
  await expect(page.getByRole('link',{name:'Synthetic Browser Driver'})).toBeVisible();
  const response=await page.request.get('/api/drivers/pool');
  expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');
  const body=await response.json();expect(body.drivers).toHaveLength(1);
  expect(body.drivers[0]).not.toHaveProperty('source');expect(body.drivers[0]).not.toHaveProperty('compensation');
  await page.getByRole('link',{name:'Synthetic Browser Driver'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Browser Driver'})).toBeVisible();
  await expect(page.getByText('2026-01-02',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Safety rating: Not rated'})).toBeVisible();
  await expect(page.getByText('Amount not recorded',{exact:true})).toBeVisible();
  const member=await prisma.user.create({data:{email:`driver-member-${randomUUID()}@example.test`,displayName:'Synthetic Member',activeCompanyId:plan.companies[0].companyId,memberships:{create:{companyId:plan.companies[0].companyId,role:'MEMBER'}}}});
  const memberContext=await browser.newContext();
  try {
   const memberPage=await memberContext.newPage();
   await memberPage.goto(`http://127.0.0.1:3100/login/email/verify#token=${await issueToken(member)}`);
   await expect.poll(()=>new URL(memberPage.url()).pathname).toBe('/tasks');
   const denied=await memberPage.request.get('http://127.0.0.1:3100/api/drivers/pool');
   expect(denied.status()).toBe(403);
  }finally{await memberContext.close();}
 }finally{await pool.end();await prisma.$disconnect();}
});
