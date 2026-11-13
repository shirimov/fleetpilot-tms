import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DriverSafetyFiles } from './driver-safety-files';
import { DriverSafetyCatalog } from './driver-safety-catalog';
import { DriverSafetyService } from './driver-safety-service';

for (const failure of [null,'file-write','file-sync','file-close','directory-open','directory-sync','directory-close'] as const) {
 test(`safety durable adapter ${failure ?? 'flushes before catalog publication'}`,async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'synthetic-safety-durable-'));
  const events:string[]=[],live=new Set<number>();
  try {
   const instrumentedOpen:typeof open=async(filename,flags,mode)=>{
    const directory=filename===path.join(root,'driver-safety-files');
    if(directory&&failure==='directory-open')throw new Error('synthetic directory-open failure');
    const handle=await open(filename,flags,mode),fd=handle.fd;
    live.add(fd);
    const stat=await handle.stat(),kind=stat.isDirectory()?'directory':'file';
    const sync=handle.sync.bind(handle),close=handle.close.bind(handle);
    if(kind==='file'&&failure==='file-write')t.mock.method(handle,'writeFile',async()=>{throw new Error('synthetic write failure');});
    t.mock.method(handle,'sync',async()=>{
     events.push(`${kind}-sync`);
     if((kind==='file'&&failure==='file-sync')||(directory&&failure==='directory-sync'))throw new Error('synthetic sync failure');
     await sync();
    });
    t.mock.method(handle,'close',async()=>{
     await close();live.delete(fd);
     if((kind==='file'&&failure==='file-close')||(directory&&failure==='directory-close'))throw new Error('synthetic close failure');
    });
    return handle;
   };
   const catalog=new DriverSafetyCatalog(root),files=new DriverSafetyFiles(root,instrumentedOpen);
   const service=new DriverSafetyService(catalog,files,async()=>({companyId:'synthetic',actorId:'synthetic',canConfigurePolicy:false}));
   const input={source:'Synthetic',reportIdentifier:'DURABLE-1',inspectionDate:'2026-01-02',violations:null,outOfService:null,reviewed:false};
   const operation=service.addInspection('source:synthetic',input,new Uint8Array([1,2,3]));
   if(failure){
    await assert.rejects(operation,/synthetic/);
    assert.equal((await catalog.read('synthetic')).revision,'0');
    assert.equal((await readdir(path.join(root,'driver-safety-files'))).length,1,'uncertain new bytes retained');
   } else {
    const id=await operation;
    assert.equal(events[0],'file-sync');
    assert.ok(events.slice(1).every(event=>event==='directory-sync'));
    assert.ok(events.length>=3,'namespace and root entries flushed');
    assert.deepEqual(Array.from(await service.download('source:synthetic',id)),[1,2,3]);
   }
   assert.equal(live.size,0,'all opened descriptors closed even on flush/open failure');
  } finally {await rm(root,{recursive:true,force:true});}
 });
}
