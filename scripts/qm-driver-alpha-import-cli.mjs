#!/usr/bin/env node
// Operator-only entrypoint inside the reviewed Alpha migrator image, not an API.
// Does not deploy, migrate, create Companies, read credential files or retry.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareAlphaImport, applyAlphaImport, validateAlphaDatabase } from '../src/lib/fleet/qm-driver-alpha-import.mjs';
import { requireImport } from '../src/lib/fleet/qm-driver-import.mjs';

const args=process.argv.slice(2);
if(args.length!==1 || !['--preview','--apply-alpha'].includes(args[0])) {
  process.stderr.write('ALPHA_DRIVER_IMPORT_REFUSED: explicit --preview or authorized --apply-alpha required.\n');
  process.exit(2);
}
let writeAttempted=false,pool;
function failure(reason) {
  process.stderr.write(`ALPHA_DRIVER_IMPORT_FAILED: ${reason}; ${writeAttempted?'OUTCOME_UNCERTAIN; verify exact target before retry':'no writes attempted'}. No automatic retry.\n`);
}
process.stdout.on('error',()=>{failure('OUTPUT_DELIVERY');process.exitCode=1;});
const timer=setTimeout(()=>{failure('TIME_LIMIT');process.exit(1);},180000);
for(const sig of ['SIGINT','SIGTERM','SIGHUP']) process.on(sig,()=>{failure('INTERRUPTED');process.exit(1);});
try {
  const chunks=[];let size=0;
  for await (const chunk of process.stdin) {
    size+=chunk.length;requireImport(size<=48*1024*1024,'INPUT_LIMIT');chunks.push(chunk);
  }
  const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  requireImport(envelope && Object.keys(envelope).sort().join(',')==='exportBase64,planBase64,receiptBase64,review','INVALID_ENVELOPE');
  function decode(value,limit) {
    requireImport(typeof value==='string' && value.length>0 && value.length<=Math.ceil(limit/3)*4 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),'INVALID_BASE64');
    const raw=Buffer.from(value,'base64');requireImport(raw.toString('base64')===value && raw.length<=limit,'INVALID_BASE64');return raw;
  }
  const input={exportBytes:decode(envelope.exportBase64,32*1024*1024),planBytes:decode(envelope.planBase64,1024*1024),receiptBytes:decode(envelope.receiptBase64,1024*1024),review:envelope.review};
  const prepared=prepareAlphaImport(input);
  let report={version:1,kind:'ALPHA_DRIVER_IMPORT_PREVIEW',applied:false,verified:false,evidenceSha256:prepared.evidenceSha256,summary:prepared.summary};
  if(args[0]==='--apply-alpha') {
    // Native existing application connection; never echo or inspect its secret.
    validateAlphaDatabase(process.env.DATABASE_URL);
    const migrationRoot=new URL('../prisma/migrations/',import.meta.url);
    const expected=readdirSync(migrationRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>({name:e.name,checksum:createHash('sha256').update(readFileSync(new URL(e.name+'/migration.sql',migrationRoot))).digest('hex')}));
    requireImport(expected.some(m=>m.name==='20261002120000_driver_source_profiles'),'DRIVER_MIGRATION_SOURCE_MISSING');
    const {Pool}=await import('pg');
    pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,idle_in_transaction_session_timeout:30000});
    report=await applyAlphaImport(pool,input,expected,()=>{writeAttempted=true;});
  }
  if(pool) {await pool.end();pool=null;}
  await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(report)+'\n',error=>error?reject(error):resolve()));
  process.exitCode=args[0]==='--preview'?2:0;
} catch {
  failure('INPUT_TARGET_OR_VERIFICATION');process.exitCode=1;
} finally {
  try {if(pool) await pool.end();} catch {failure('CONNECTION_CLOSE');process.exitCode=1;}
  clearTimeout(timer);
}
