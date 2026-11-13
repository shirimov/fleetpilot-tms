import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, rm, mkdir, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { DriverSafetyService } from './driver-safety-service';
import { DriverSafetyFiles } from './driver-safety-files';
import { join } from 'node:path';
import { DriverSafetyCatalog } from './driver-safety-catalog';

// Real filesystem calls with bounded fault injection; not a crash-recovery test.
for (const existingRoot of [false,true]) {
 for (const failure of [null,'catalog-sync','root-sync','ancestor-sync','root-open'] as const) {
  test(`policy-first publication (${existingRoot ? 'existing' : 'new nested'} root): ${failure ?? 'ordered durable ancestry'}`,async t=>{
   const parent=await mkdtemp(join(tmpdir(),'synthetic-policy-first-'));
   const root=existingRoot ? parent : join(parent,'new-parent','new-storage');
   const namespace=join(root,'driver-safety-catalog');
   const directories:string[]=[];
   for(let directory=namespace;;directory=dirname(directory)){
    directories.push(directory);if(dirname(directory)===directory)break;
   }
   const events:string[]=[],live=new Set<number>();
   const realOpen=open,realRename=fs.rename;
   const failedDirectory=failure==='catalog-sync' ? namespace : failure==='ancestor-sync' ? dirname(root) : root;
   try {
    t.mock.method(fs,'rename',async(...args:Parameters<typeof fs.rename>)=>{
     await realRename(...args);events.push('rename');
    });
    t.mock.method(fs,'open',async(...args:Parameters<typeof open>)=>{
     if(failure==='root-open'&&String(args[0])===root)throw new Error('synthetic ancestry sync failure');
     const handle=await realOpen(...args),fd=handle.fd;
     const filename=String(args[0]),isDirectory=(await handle.stat()).isDirectory();
     live.add(fd);
     const sync=handle.sync.bind(handle),close=handle.close.bind(handle);
     t.mock.method(handle,'sync',async()=>{
      events.push(isDirectory ? filename : 'file-sync');
      if(isDirectory){
       assert.equal(Number(args[1]) & (constants.O_DIRECTORY | constants.O_NOFOLLOW),constants.O_DIRECTORY | constants.O_NOFOLLOW);
       if(failure&&filename===failedDirectory)throw new Error('synthetic ancestry sync failure');
      }
      await sync();
     });
     t.mock.method(handle,'close',async()=>{await close();live.delete(fd);});
     return handle;
    });
    const catalog=new DriverSafetyCatalog(root),files=new DriverSafetyFiles(root);
    t.mock.method(files,'put',async()=>{throw new Error('policy must not write attachments');});
    const service=new DriverSafetyService(catalog,files,async()=>({companyId:'synthetic',actorId:'synthetic-owner',canConfigurePolicy:true}));
    const operation=service.setPolicy('source:synthetic',{label:'Synthetic first policy',enabled:true,maximum:100,minimum:0,violationPenalty:5,outOfServicePenalty:10,windowStart:'2026-01-01',windowEnd:'2026-12-31'});
    if(failure)await assert.rejects(operation,/synthetic ancestry sync failure/);
    else {
     const id=await operation;
     assert.equal((await service.get('source:synthetic')).policy?.id,id);
    }
    const expectedDirectories=failure ? directories.slice(0,directories.indexOf(failedDirectory)+(failure==='root-open' ? 0 : 1)) : directories;
    assert.deepEqual(events,['file-sync','rename',...expectedDirectories]);
    assert.equal(live.size,0,'all opened descriptors closed on success and failed ancestry flush');
    const state=await catalog.read('synthetic');
    assert.equal(state.policies.length,1,'uncertain renamed catalog retained, never rolled back');
    assert.equal(state.audit[0].action,'RATING_POLICY_VERSION_CREATED');
    assert.equal(state.drivers['source:synthetic'].photo,null);
    assert.deepEqual(await readdir(join(root,'driver-safety-files')),[]);
    assert.ok((await readdir(namespace)).every(name=>name.endsWith('.json')),'existing cleanup removes temporary/lock files');
   } finally {t.mock.restoreAll();await rm(parent,{recursive:true,force:true});}
  });
 }
}

test('private adjunct rejects a preexisting nonprivate attachment namespace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'synthetic-driver-catalog-'));
 try {await mkdir(join(root,'driver-safety-files'),{mode:0o755});await assert.rejects(new DriverSafetyCatalog(root).read('synthetic'),/owner-only/);}finally{await rm(root,{recursive:true,force:true});}
});
test('private adjunct catalog persists scoped records and authorizes inside write lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'synthetic-driver-catalog-'));
 try {
  const catalog=new DriverSafetyCatalog(root);
  let checks=0;
  await catalog.change('synthetic-company',async()=>{checks++;},state=>{state.audit.push({action:'SYNTHETIC_TEST',actorId:'synthetic-actor',driverId:'source:synthetic',at:'2026-01-01T00:00:00Z'});});
  // Capacity must fail before a callback can persist attachment bytes.
  await catalog.change('synthetic-capacity',async()=>{},state=>{state.audit=Array.from({length:10000},()=>({action:'SYNTHETIC',actorId:'synthetic',driverId:'source:synthetic',at:'2026-01-01'}));});
  let mutated=false;
  await assert.rejects(catalog.change('synthetic-capacity',async()=>{},()=>{mutated=true;throw new Error('callback ran');}),/capacity/);
  assert.equal(mutated,false);
  assert.equal(checks,1);
  assert.equal((await new DriverSafetyCatalog(root).read('synthetic-company')).audit.length,1);
  assert.equal((await catalog.read('synthetic-other')).audit.length,0);
  await assert.rejects(catalog.change('synthetic-company',async()=>{throw new Error('denied');},state=>{state.audit=[];}),/denied/);
  assert.equal((await catalog.read('synthetic-company')).audit.length,1);
 } finally {await rm(root,{recursive:true,force:true});}
});
