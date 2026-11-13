import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync,linkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

// Synthetic special files only; never exercise this against retained exports.
test('CLI rejects FIFO input promptly instead of blocking before file validation',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-cli-'));chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.pipe');
  const made=spawnSync('mkfifo',['-m','600',input]);assert.equal(made.status,0);
  const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'output.json')],{encoding:'utf8',timeout:1500});
  assert.equal(result.error,undefined,'private input validation must not block opening a FIFO');
  assert.equal(result.status,1);assert.match(result.stderr,/DRIVER_IMPORT_FAILED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fixture,scope,mapping} from './qm-driver-fixture.mjs';

test('private leaf under replaceable writable ancestor is refused',()=>{
 const parent=mkdtempSync(join(tmpdir(),'driver-unsafe-parent-'));
 try {
  chmodSync(parent,0o777);
  const directory=join(parent,'private');mkdirSync(directory,{mode:0o700});
  const input=join(directory,'input.json');writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'output.json')],{encoding:'utf8'});
  assert.equal(result.status,1,'a private leaf is not safe if another user can rename it');
 }finally{rmSync(parent,{recursive:true,force:true});}
});

test('stdout delivery failure exits nonzero with sanitized uncertainty',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-delivery-'));chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.json'),hook=join(directory,'hook.mjs');
  writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  writeFileSync(hook,"process.stdout.write=()=>{queueMicrotask(()=>process.stdout.emit('error',new Error('SYNTHETIC_PRIVATE_DELIVERY')));return true;};",{mode:0o600});
  const result=spawnSync(process.execPath,['--import',hook,'scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'output.json')],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/DRIVER_IMPORT_DELIVERY_FAILED/);
  assert.doesNotMatch(result.stderr,/SYNTHETIC_PRIVATE_DELIVERY|Unhandled 'error'/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('missing config argument fails closed instead of silently using unconfigured preview',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-cli-'));chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.json');writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'output.json'),'--config'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/DRIVER_IMPORT_FAILED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('private inputs reject hard links whose other locations cannot be certified',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-cli-'));chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.json');writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  linkSync(input,join(directory,'alias.json'));
  const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'output.json')],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/DRIVER_IMPORT_FAILED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('genuine-format preview requires no invented account or mappings and never emits personal data',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-cli-')); chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.json'),output=join(directory,'preview.json');
  writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',output],{encoding:'utf8'});
  assert.equal(result.status,2,result.stderr);
  const preview=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(preview.summary.uniqueDrivers,1); assert.equal(preview.summary.insertable,0);
  assert.deepEqual(preview.mappingGaps,['source-company']);
  assert.doesNotMatch(result.stdout+result.stderr+JSON.stringify(preview),/Synthetic Test|synthetic.invalid/);
 } finally {rmSync(directory,{recursive:true,force:true});}
});

test('mapped preview does not require an invented actor; apply still requires one',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-cli-'));chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.json'),config=join(directory,'config.json'),output=join(directory,'preview.json');
  writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  writeFileSync(config,JSON.stringify({scope,mappings:[mapping]}),{mode:0o600});
  const preview=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',output,'--config',config],{encoding:'utf8'});
  assert.equal(preview.status,2,preview.stderr);
  const result=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(result.summary.mappedDrivers,1);
  assert.deepEqual(result.mappingGaps,[]);
  assert.ok(result.blockers.includes('VERIFIED_IMPORT_ACTOR_REQUIRED'));
  const apply=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'apply.json'),'--config',config,'--apply-local'],{encoding:'utf8'});
  assert.equal(apply.status,1);assert.match(apply.stderr,/DRIVER_IMPORT_FAILED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('apply rejects remote targets before connecting and public input is refused',()=>{
 const directory=mkdtempSync(join(tmpdir(),'driver-cli-'));chmodSync(directory,0o700);
 try {
  const input=join(directory,'input.json'),config=join(directory,'config.json'),output=join(directory,'output.json');
  writeFileSync(input,JSON.stringify([fixture()]),{mode:0o600});
  writeFileSync(config,JSON.stringify({scope,mappings:[mapping],actorUserId:'synthetic-actor'}),{mode:0o600});
  const result=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',output,'--config',config,'--apply-local'],{encoding:'utf8',env:{...process.env,DRIVER_IMPORT_DATABASE_URL:'postgresql://synthetic.invalid/fleetpilot_driver_import_test_synthetic'}});
  assert.equal(result.status,1);assert.match(result.stderr,/DRIVER_IMPORT_FAILED/);assert.doesNotMatch(result.stderr,/synthetic.invalid/);
  chmodSync(input,0o644);
  const publicResult=spawnSync(process.execPath,['scripts/qm-driver-import-cli.mjs','--input',input,'--output',join(directory,'other.json')],{encoding:'utf8'});
  assert.equal(publicResult.status,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
