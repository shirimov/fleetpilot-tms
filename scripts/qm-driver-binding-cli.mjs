#!/usr/bin/env node
import {constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync,fsyncSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {privateDirectory} from './qm-driver-private-directory.mjs';
import {validateProvisionInput} from '../src/lib/fleet/qm-driver-company.mjs';
import {bindProvisionedCompanies} from '../src/lib/fleet/qm-driver-binding.mjs';
import {postgresStore} from '../src/lib/fleet/qm-driver-store.mjs';
import {requireImport} from '../src/lib/fleet/qm-driver-import.mjs';

function readPrivate(path) {
 const input=resolve(path);privateDirectory(dirname(input));
 const fd=openSync(input,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const info=fstatSync(fd);requireImport(info.isFile()&&info.nlink===1&&(info.mode&0o077)===0&&info.uid===process.getuid()&&info.size<=1024*1024,'PRIVATE_FILE_REQUIRED');return readFileSync(fd);}finally{closeSync(fd);}
}
function reserve(path) {
 const output=resolve(path);privateDirectory(dirname(output));
 return openSync(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
}
function save(fd,value) {writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}
let applyAttempted=false;
// A failed stdout delivery after apply is uncertain too; never dump raw errors.
process.stdout.on('error',()=>{process.stderr.write('DRIVER_BINDING_DELIVERY_FAILED: outcome may be uncertain. No automatic retry.\n');process.exitCode=1;});
try {
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++) {
  const key=args[i];requireImport(['--plan','--receipt','--config','--output','--apply-local','--import-config-output'].includes(key)&&!Object.hasOwn(options,key),'INVALID_ARGUMENTS');
  if(key==='--apply-local'){options[key]=true;continue;}
  options[key]=args[++i];requireImport(typeof options[key]==='string'&&options[key].length>0&&!options[key].startsWith('--'),'INVALID_ARGUMENTS');
 }
 requireImport(['--plan','--receipt','--config','--output'].every(k=>typeof options[k]==='string'),'INVALID_ARGUMENTS');
 requireImport(Boolean(options['--apply-local'])===Boolean(options['--import-config-output']),'INVALID_ARGUMENTS');
 const planBytes=readPrivate(options['--plan']),receiptBytes=readPrivate(options['--receipt']);
 const config=JSON.parse(readPrivate(options['--config']).toString('utf8'));
 requireImport(Object.keys(config).sort().join(',')==='actorUserId,reviewedPlanSha256,reviewedReceiptSha256','INVALID_CONFIG');
 const input={...config,plan:JSON.parse(planBytes.toString('utf8')),receipt:JSON.parse(receiptBytes.toString('utf8')),planBytes,receiptBytes,mode:'BIND_PROVISIONED'};
 validateProvisionInput(input);
 let connection;
 if(options['--apply-local']) {
  connection=process.env.DRIVER_IMPORT_DATABASE_URL;
  requireImport(typeof connection==='string','LOCAL_DATABASE_REQUIRED');
  const url=new URL(connection);
  requireImport(['postgres:','postgresql:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/fleetpilot_driver_import_test_[a-z0-9_]+$/.test(url.pathname)&&url.search===''&&url.hash==='','DISPOSABLE_LOCAL_DATABASE_REQUIRED');
 }
 let report={version:1,kind:'DRIVER_BINDING_PREVIEW',applied:false,verified:false,planSha256:config.reviewedPlanSha256,receiptSha256:config.reviewedReceiptSha256,summary:{companiesToBind:input.plan.companies.length,existingMappings:input.plan.existingMappings.length},blockers:['TARGET_BINDING_AND_AUTHORIZATION_RECHECK_REQUIRED']};
 const fd=reserve(options['--output']);let configFd;
 try {
  if(options['--apply-local']) {
   // Both exclusive outputs are reserved before the first DB operation.
   configFd=reserve(options['--import-config-output']);
   const {Pool}=await import('pg');const pool=new Pool({connectionString:connection,max:1,connectionTimeoutMillis:5000,statement_timeout:30000});
   try {applyAttempted=true;report=await bindProvisionedCompanies(postgresStore(pool),input);}finally{await pool.end();}
   save(fd,report);save(configFd,report.importConfig);
  } else save(fd,report);
 } finally {try {if(configFd!==undefined)closeSync(configFd);}finally{closeSync(fd);}}
 process.stdout.write(JSON.stringify(report.summary)+'\n');process.exitCode=options['--apply-local']?0:2;
} catch(error) {
 const code=['LOCAL_DATABASE_REQUIRED','DISPOSABLE_LOCAL_DATABASE_REQUIRED'].includes(error?.message)?error.message:'PRIVATE_INPUT_OR_BINDING_CHECK_FAILED';
 process.stderr.write(`DRIVER_BINDING_FAILED: ${applyAttempted?'APPLY_OUTCOME_UNCERTAIN; verify exact target before retry':code}. No automatic retry.\n`);process.exitCode=1;
}
