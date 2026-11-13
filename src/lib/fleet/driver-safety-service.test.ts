import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DriverSafetyCatalog } from './driver-safety-catalog';
import { DriverSafetyService } from './driver-safety-service';
import { photoCommitMatches } from './driver-safety-photo-commit';
import { FilesystemPrivateFileStorage } from '../storage/private-file-storage';

test('persisted evidence stays separate, policy is opt-in, duplicate reports never inflate ratings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'synthetic-driver-service-'));
 let allowed=true;
 const authorize=async()=>{if(!allowed)throw new Error('denied');return {companyId:'synthetic-company',actorId:'synthetic-owner',canConfigurePolicy:true};};
 try {
  const service=new DriverSafetyService(new DriverSafetyCatalog(root),new FilesystemPrivateFileStorage('driver-safety-files',root),authorize);
  const id='source:synthetic';
  assert.equal((await service.get(id)).rating.score,null);
  const metadata={source:'Synthetic original',reportIdentifier:'SYN-1',inspectionDate:'2026-01-02',violations:1,outOfService:false,reviewed:true};
  await service.addInspection(id,metadata,new Uint8Array([1,2,3]));
  const snapshot=await service.get(id);
  assert.equal(snapshot.inspections.length,1);assert.equal(snapshot.rating.score,null);
  assert.ok(!JSON.stringify(snapshot).includes('storageKey'));
  await assert.rejects(service.addInspection(id,metadata,new Uint8Array([1,2,3])),/already/);
  await service.setPolicy(id,{label:'Synthetic explicit',enabled:true,maximum:100,minimum:0,violationPenalty:5,outOfServicePenalty:10,windowStart:'2026-01-01',windowEnd:'2026-12-31'});
  assert.equal((await service.get(id)).rating.score,95);
  assert.deepEqual(Array.from(await service.download(id,snapshot.inspections[0].id)),[1,2,3]);
  const sharp=createRequire(import.meta.url)('sharp');
  const pixels=await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer();
  const committed=await service.setPhoto(id,new Uint8Array(pixels),'image/png');
  const photoState=await service.get(id);assert.ok(photoState.photoVersion);
  assert.deepEqual(committed,{revision:photoState.revision,photoId:photoState.photoId,photoVersion:photoState.photoVersion});
  const replaced=await service.setPhoto(id,new Uint8Array(pixels),'image/png');
  assert.notEqual(replaced.photoId,committed.photoId);
  assert.notEqual(replaced.revision,committed.revision);
  const laterReadback=await service.get(id);
  assert.equal(laterReadback.photoVersion,committed.photoVersion,'same bytes can still be a different upload');
  assert.equal(photoCommitMatches(committed,laterReadback),false);
  assert.equal(photoCommitMatches(replaced,laterReadback),true);
  const decoded=await sharp(await service.photo(id)).metadata();assert.equal(decoded.format,'webp');assert.equal(decoded.exif,undefined);
  const stale=new DriverSafetyService(new DriverSafetyCatalog(root),new FilesystemPrivateFileStorage('driver-safety-files',root),authorize,'0');
  await assert.rejects(stale.removePhoto(id),/changed/);
  await service.removePhoto(id);assert.equal(await service.photo(id),null);
  assert.equal((await service.get(id)).photoVersion,null);
  const corrected=await service.addInspection(id,{...metadata,violations:0},undefined,snapshot.inspections[0].id);
  const revised=await service.get(id);assert.equal(revised.rating.score,100);assert.equal(revised.inspections.length,2);assert.ok(revised.inspections.some(record=>record.id===corrected&&record.current));
  const otherCompany=new DriverSafetyService(new DriverSafetyCatalog(root),new FilesystemPrivateFileStorage('driver-safety-files',root),async()=>({companyId:'synthetic-other-company',actorId:'synthetic-other-owner',canConfigurePolicy:true}));
  assert.equal((await otherCompany.get(id)).inspections.length,0);
  await assert.rejects(otherCompany.download(id,snapshot.inspections[0].id),/not found/);
  const admin=new DriverSafetyService(new DriverSafetyCatalog(root),new FilesystemPrivateFileStorage('driver-safety-files',root),async()=>({companyId:'synthetic-company',actorId:'synthetic-admin',canConfigurePolicy:false}));
  await assert.rejects(admin.setPolicy(id,{label:'Denied synthetic',enabled:true,maximum:100,minimum:0,violationPenalty:5,outOfServicePenalty:10,windowStart:'2026-01-01',windowEnd:'2026-12-31'}),/owner/);
  allowed=false;await assert.rejects(service.get(id),/denied/);await assert.rejects(service.download(id,snapshot.inspections[0].id),/denied/);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('metadata correction adds zero files at cap; uploads and revision overflow remain refused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'synthetic-driver-quota-'));
 try {
  const catalog=new DriverSafetyCatalog(root);
  const service=new DriverSafetyService(catalog,new FilesystemPrivateFileStorage('driver-safety-files',root),async()=>({companyId:'synthetic-cap',actorId:'synthetic-owner',canConfigurePolicy:true}));
  const id='source:synthetic',metadata={source:'Synthetic report',reportIdentifier:'CAP-1',inspectionDate:'2026-01-02',violations:null,outOfService:null,reviewed:false};
  const first=await service.addInspection(id,metadata,new Uint8Array([1]));
  // Bounded catalog fixture, not a bulk-upload or operational reproduction probe.
  await catalog.change('synthetic-cap',async()=>{},async state=>{
   for(let i=1;i<2000;i++)state.drivers[`source:fixture-${i}`]={photo:{key:`synthetic-${i}`,bytes:1,sha256:'synthetic',mime:'image/webp'},inspections:[]};
  });
  const reviewed=await service.addInspection(id,{...metadata,reviewed:true,violations:0,outOfService:false},undefined,first);
  const state=await catalog.read('synthetic-cap');
  assert.deepEqual(state.drivers[id].inspections[1].file,state.drivers[id].inspections[0].file);
  assert.equal(state.drivers[id].inspections[1].id,reviewed);
  await assert.rejects(service.addInspection(id,{...metadata,reportIdentifier:'CAP-2'},new Uint8Array([2])),/attachment capacity/);
  await catalog.change('synthetic-cap',async()=>{},async state=>{
   const records=state.drivers[id].inspections;
   while(records.length<200)records.push({...records[0],id:`synthetic-revision-${records.length}`});
  });
  await assert.rejects(service.addInspection(id,metadata,undefined,reviewed),/evidence capacity/);
 } finally {await rm(root,{recursive:true,force:true});}
});
