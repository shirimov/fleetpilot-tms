#!/usr/bin/env node
import {constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {privateDirectory} from './qm-driver-private-directory.mjs';
import {createHash} from 'node:crypto';
import {adaptExport,planImport,importDrivers,requireImport,identifier} from '../src/lib/fleet/qm-driver-import.mjs';
import {postgresStore} from '../src/lib/fleet/qm-driver-store.mjs';
function readPrivate(path) {
 const input=resolve(path);privateDirectory(dirname(input));
 // Open nonblocking so special files cannot hang before the descriptor check.
 const fd=openSync(input,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const info=fstatSync(fd);requireImport(info.isFile()&&info.nlink===1&&(info.mode&0o077)===0&&info.uid===process.getuid()&&info.size<=32*1024*1024,'PRIVATE_FILE_REQUIRED');return readFileSync(fd);}finally{closeSync(fd);}
}
process.stdout.on('error',()=>{
 process.stderr.write('DRIVER_IMPORT_DELIVERY_FAILED: outcome may be uncertain. Verify exact target before retry. No automatic retry.\n');
 process.exitCode=1;
});
try {
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++) {
  const key=args[i]; requireImport(['--input','--output','--config','--apply-local'].includes(key)&&!Object.hasOwn(options,key),'INVALID_ARGUMENTS');
  options[key]=key==='--apply-local'?true:args[++i];
  if(key!=='--apply-local') requireImport(typeof options[key]==='string' && options[key].length>0 && !options[key].startsWith('--'),'INVALID_ARGUMENTS');
 }
 requireImport(typeof options['--input']==='string' && typeof options['--output']==='string','INVALID_ARGUMENTS');
 const bytes=readPrivate(options['--input']); const rows=JSON.parse(bytes.toString('utf8')); const adapted=adaptExport(rows);
 const evidenceSha256=createHash('sha256').update(bytes).digest('hex');
 const config=options['--config']?JSON.parse(readPrivate(options['--config']).toString('utf8')):null;
 if(config) {
  requireImport(['mappings,scope','actorUserId,mappings,scope'].includes(Object.keys(config).sort().join(',')),'INVALID_CONFIG');
  if(Object.hasOwn(config,'actorUserId')) identifier(config.actorUserId);
 }
 if(options['--apply-local']) identifier(config?.actorUserId);
 const unique=new Map();
 for(const row of adapted) {const key=JSON.stringify([row.source.company_id,row.source.qm_driver_id]);requireImport(!unique.has(key)||unique.get(key).sourceHash===row.sourceHash,'CONFLICTING_SOURCE_IDENTITY');unique.set(key,row);}
 const plan=config?planImport(adapted,config.scope,config.mappings):null;
 const statuses={}; for(const row of unique.values()) {const status=['active','terminated','invited','on_vacation','deleted','incomplete'].includes(row.source.status)?row.source.status:'unknown';statuses[status]=(statuses[status]??0)+1;}
 const report={evidenceSha256,summary:{sourceRows:rows.length,uniqueDrivers:unique.size,duplicateRows:rows.length-unique.size,detailRecords:[...unique.values()].filter(row=>row.source.provenance.detail!==null).length,statuses,mappedDrivers:plan?.summary.mappedDrivers??0,insertable:0},mappingGaps:plan?.mappingGaps??[...new Set(adapted.map(row=>row.source.company_id))].sort(),blockers:config?['TARGET_MAPPING_AND_AUTHORIZATION_RECHECK_REQUIRED']:['VERIFIED_ACCOUNT_AND_OPERATING_GROUP_REQUIRED','VERIFIED_COMPANY_MAPPINGS_REQUIRED']};
 if(config && !config.actorUserId) report.blockers.push('VERIFIED_IMPORT_ACTOR_REQUIRED');
 const output=resolve(options['--output']);privateDirectory(dirname(output));
 // Reserve output before writes so an output collision cannot occur after commit.
 const fd=openSync(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try {
  if(options['--apply-local']) {
   requireImport(config && report.mappingGaps.length===0,'VERIFIED_SCOPE_AND_MAPPING_REQUIRED');
   // This launcher deliberately cannot point to Alpha or an arbitrary remote DB.
   const connection=process.env.DRIVER_IMPORT_DATABASE_URL; requireImport(typeof connection==='string','LOCAL_DATABASE_REQUIRED');
   const url=new URL(connection);
   requireImport(['postgres:','postgresql:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/fleetpilot_driver_import_test_[a-z0-9_]+$/.test(url.pathname)&&url.search===''&&url.hash==='','DISPOSABLE_LOCAL_DATABASE_REQUIRED');
   const {Pool}=await import('pg');const pool=new Pool({connectionString:connection,max:1,connectionTimeoutMillis:5000,statement_timeout:30000});
   try {report.result=await importDrivers(postgresStore(pool),{rows,...config,evidenceSha256}); report.blockers=[];}finally{await pool.end();}
  }
  writeFileSync(fd,JSON.stringify(report,null,2)+'\n');
 } finally {closeSync(fd);}
 process.stdout.write(JSON.stringify(report.summary)+'\n');process.exitCode=options['--apply-local']?0:2;
} catch {process.stderr.write('DRIVER_IMPORT_FAILED: private input, scope, mapping, authorization, conflict or local database check failed. No automatic retry.\n');process.exitCode=1;}
