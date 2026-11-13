// Local, explicitly synthetic UI harness. Bundles the real production component;
// never imports the DB, provisions services, or adds an authentication bypass.
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DriverSafetyCatalog, DriverSafetyConflictError } from '../src/lib/fleet/driver-safety-catalog.ts';
import { DriverSafetyService } from '../src/lib/fleet/driver-safety-service.ts';
import { DriverSafetyFiles } from '../src/lib/fleet/driver-safety-files.ts';
import { photoCommitMatches } from '../src/lib/fleet/driver-safety-photo-commit.ts';
import { readSafetyBody, requireSafetyMutation, safetyError } from '../src/lib/fleet/driver-safety-http.ts';
import assert from 'node:assert/strict';

const root = process.cwd();
const output = await mkdtemp(join(process.env.TMPDIR || '/home/hermes/.hermes/cache/scratch', 'driver-pool-ui-'));
await chmod(output, 0o700);
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Workspace from './src/components/fleet/DriverPoolWorkspace';const q=new URLSearchParams(location.search);const id=location.pathname.startsWith('/drivers/pool/')?decodeURIComponent(location.pathname.slice('/drivers/pool/'.length)):undefined;createRoot(document.getElementById('root')).render(<><aside style={{padding:'12px 24px',background:'#422006',color:'#fde68a',fontSize:13}}>SYNTHETIC UI FIXTURE · Not real company or driver data · No database</aside><Workspace driverId={id} page={q.get('page')||'1'} status={q.get('status')||'ALL'} search={q.get('q')||''}/></>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, jsx: 'automatic' });
const css = await postcss([tailwind({ base: root })]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') });
const drivers = [
  ['source:synthetic-1', 'Synthetic Avery', 'Stone', 'active'],
  ['source:synthetic-2', 'Synthetic Morgan', 'Lane', 'active'],
  ['source:synthetic-3', 'Synthetic Casey', 'River', 'terminated'],
  ['source:synthetic-4', 'Synthetic Riley', 'Park', 'invited'],
  ['driver:synthetic-5', 'Synthetic Jordan', 'Vale', 'UNKNOWN'],
  ['source:synthetic-6', 'Synthetic Cameron', 'Reed', 'active'],
].map(([id, firstName, lastName, employmentStatus]) => ({ id, firstName, lastName, fullName: null, employmentStatus, safetyRating: 'NOT_RATED' }));
const syntheticService = revision => new DriverSafetyService(new DriverSafetyCatalog(output),new DriverSafetyFiles(output),async id=>{
  if(!drivers.some(driver=>driver.id===id))throw new Error('Unknown synthetic driver');
  return {companyId:'synthetic-ui-company',actorId:'synthetic-ui-owner',canConfigurePolicy:true};
},revision);
let failNext = false;
let delayNext = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(bundle.outputFiles[0].text); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css.css); }
  if (url.pathname.startsWith('/api/drivers/pool')) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'private, no-store');
    if (delayNext) { delayNext = false; await new Promise(resolve => setTimeout(resolve, 700)); }
    if (failNext) { failNext = false; res.statusCode = 503; return res.end('{}'); }
    const safetyMatch=url.pathname.match(/^\/api\/drivers\/pool\/([^/]+)\/(safety|photo)(?:\/([^/]+))?$/);
    if(safetyMatch) {
      try {
        const id=decodeURIComponent(safetyMatch[1]);
        if(req.method==='GET') {
          const service=syntheticService();
          if(safetyMatch[2]==='photo') {const bytes=await service.photo(id);res.setHeader('Content-Type','image/webp');res.statusCode=bytes?200:404;return res.end(bytes?Buffer.from(bytes):'');}
          if(safetyMatch[3]) {res.setHeader('Content-Type','application/octet-stream');return res.end(Buffer.from(await service.download(id,safetyMatch[3])));}
          return res.end(JSON.stringify(await service.get(id)));
        }
        const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>11*1024*1024)throw new Error('Fixture body bound');}
        const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,body:req.method==='DELETE'?undefined:Buffer.concat(chunks)});
        const service=syntheticService(requireSafetyMutation(request));
        let photoCommit;
        if(safetyMatch[2]==='photo') {
          if(req.method==='DELETE')await service.removePhoto(id);
          else photoCommit=await service.setPhoto(id,await readSafetyBody(request,5*1024*1024),request.headers.get('content-type'));
        } else if(request.headers.get('content-type')?.startsWith('application/json')) {
          const body=JSON.parse(new TextDecoder().decode(await readSafetyBody(request,16384)));await service.setPolicy(id,body.policy);
        } else {
          const bytes=await readSafetyBody(request,10*1024*1024+32768);
          const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')}}).formData();
          const report=form.get('report');await service.addInspection(id,JSON.parse(form.get('metadata')),report?new Uint8Array(await report.arrayBuffer()):undefined,form.get('supersedes'));
        }
        const readback=await service.get(id);
        if(photoCommit&&!photoCommitMatches(photoCommit,readback))throw new DriverSafetyConflictError('Photo changed after saving.');
        return res.end(JSON.stringify({...readback,...(photoCommit?{photoCommit}:{})}));
      } catch(error) {const failure=safetyError(error);res.statusCode=failure.status;return res.end(await failure.text());}
    }
    if (url.pathname === '/api/drivers/pool') {
      const status = url.searchParams.get('status') || 'ALL', search = url.searchParams.get('q') || '';
      const matches = drivers.filter(d => (status === 'ALL' || d.employmentStatus === status) && `${d.firstName} ${d.lastName}`.toLowerCase().includes(search.toLowerCase()));
      const enriched=await Promise.all(matches.map(async driver=>{const safety=await syntheticService().get(driver.id);return {...driver,photoVersion:safety.photoVersion,internalRating:safety.rating.score};}));
      return res.end(JSON.stringify({ page: 1, status, search, hasMore: false, drivers: enriched }));
    }
    const driver = drivers.find(d => d.id === decodeURIComponent(url.pathname.slice('/api/drivers/pool/'.length)));
    if (!driver) { res.statusCode = 404; return res.end('{}'); }
    const safety=await syntheticService().get(driver.id);
    return res.end(JSON.stringify({ ...driver, photoVersion:safety.photoVersion, internalRating:safety.rating.score, phone: null, email: null, hireDate: '2026-01-02', terminationDate: null, rehireDate: null, compensation: { type: 'UNKNOWN', amount: null, frequency: null, currency: null } }));
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Driver Pool UI check</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  console.log(JSON.stringify({ origin, output, synthetic: true }));
  await new Promise(resolve => process.once('SIGTERM', resolve));
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
}
let browser;
const checks = [];
try {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.DRIVER_TEST_CHROME_PATH ? { executablePath: process.env.DRIVER_TEST_CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/drivers/pool');
  await page.getByRole('list', { name: 'Company driver roster' }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 6); checks.push('six synthetic cards');
  await page.screenshot({ path: join(output, 'synthetic-roster-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  assert.equal(await page.getByRole('table').count(), 1); checks.push('table toggle');
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await page.getByLabel('Search drivers').fill('Avery');
  await page.getByLabel('Search drivers').press('Enter');
  await page.getByRole('link', { name: 'Synthetic Avery Stone', exact: true }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 1); checks.push('keyboard search');
  await page.getByRole('link', { name: 'Former', exact: true }).click();
  await page.getByRole('heading', { name: 'No matching drivers' }).waitFor(); checks.push('filter retains search; empty state');
  await page.getByRole('link', { name: 'Reset filters' }).click();
  await page.getByRole('link', { name: 'Former', exact: true }).click();
  await page.getByRole('link', { name: 'Synthetic Casey River' }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 1); checks.push('former filter');
  await page.getByRole('link', { name: 'Synthetic Casey River' }).click();
  await page.getByRole('heading', { name: 'Safety rating: Not rated' }).waitFor();
  await page.getByText('Add inspection evidence', {exact:true}).click();
  await page.getByLabel('Report source',{exact:true}).waitFor();
  assert.equal(await page.locator('img').count(), 0); checks.push('detail, evidence disclosure, no fabricated photos');
  await page.screenshot({ path: join(output, 'synthetic-profile-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'synthetic-profile-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); checks.push('mobile detail no horizontal overflow');
  await page.getByRole('link', { name: 'Back to pool' }).click();
  await page.getByRole('list', { name: 'Company driver roster' }).waitFor();
  await page.screenshot({ path: join(output, 'synthetic-roster-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); checks.push('mobile roster no horizontal overflow');
  failNext = true; await page.reload();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('list', { name: 'Company driver roster' }).waitFor(); checks.push('error and retry');
  delayNext = true; await page.reload();
  await page.getByText('Loading driver records…').waitFor();
  await page.getByRole('list', { name: 'Company driver roster' }).waitFor(); checks.push('loading state');
  assert.deepEqual(errors, []); checks.push('no browser runtime errors');
  await writeFile(join(output, 'verification.json'), JSON.stringify({ synthetic: true, checks, errors, note: 'Real React production component, synthetic HTTP fixtures; NOT DB, Next routing/auth, or live-company acceptance.' }, null, 2), { mode: 0o600 });
  for (const file of ['synthetic-roster-desktop.png', 'synthetic-profile-desktop.png', 'synthetic-profile-mobile.png', 'synthetic-roster-mobile.png']) await chmod(join(output, file), 0o600);
  console.log(JSON.stringify({ output, checks }, null, 2));
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
