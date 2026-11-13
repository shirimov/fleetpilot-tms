import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync,chmodSync,symlinkSync,linkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {scope} from './qm-driver-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(run) {
 const dir=mkdtempSync(join(tmpdir(),'binding-cli-'));
 const plan={version:1,intent:'CREATE_MISSING_QM_COMPANIES',scope,evidenceSha256:'a'.repeat(64),mappingSha256:'b'.repeat(64),existingMappings:[],companies:[{providerCompanyId:'synthetic-source',companyId:'11111111-1111-4111-8111-111111111111',membershipId:'22222222-2222-4222-8222-222222222222',companyName:'Synthetic Private Carrier '}]};
 const planBytes=JSON.stringify(plan,null,2)+'\n';
 const receipt={version:1,kind:'COMPANY_CREATION_RECEIPT',applied:true,verified:true,created:1,existing:0,ownerUserId:'synthetic-owner',companies:plan.companies.map(({providerCompanyId,companyId,membershipId})=>({providerCompanyId,companyId,membershipId})),wouldCreate:0,verification:'POST_COMMIT_READ_ONLY',planSha256:sha(planBytes),evidenceSha256:plan.evidenceSha256,mappingSha256:plan.mappingSha256,scope};
 const receiptBytes=JSON.stringify(receipt,null,2)+'\n';
 const config={actorUserId:'synthetic-owner',reviewedPlanSha256:sha(planBytes),reviewedReceiptSha256:sha(receiptBytes)};
 for(const [name,bytes] of [['plan',planBytes],['receipt',receiptBytes],['config',JSON.stringify(config)]])writeFileSync(join(dir,name+'.json'),bytes,{mode:0o600});
 const args=['scripts/qm-driver-binding-cli.mjs','--plan',join(dir,'plan.json'),'--receipt',join(dir,'receipt.json'),'--config',join(dir,'config.json'),'--output',join(dir,'output.json')];
 try {run({dir,args,config,receipt});}finally{rmSync(dir,{recursive:true,force:true});}
}
for(const problem of ['hash','receipt','public-file','public-directory','symlink','hardlink','fifo','collision','remote','query-override','bad-database','create-mode']) test(`binding CLI rejects ${problem} without leaking private data`,()=>fixture(({dir,args,config,receipt})=>{
 const planPath=join(dir,'plan.json'),output=join(dir,'output.json');let env={PATH:process.env.PATH};
 if(problem==='hash')writeFileSync(join(dir,'config.json'),JSON.stringify({...config,reviewedPlanSha256:'f'.repeat(64)}));
 if(problem==='receipt'){
  const bytes=JSON.stringify({...receipt,verified:false});writeFileSync(join(dir,'receipt.json'),bytes);
  writeFileSync(join(dir,'config.json'),JSON.stringify({...config,reviewedReceiptSha256:sha(bytes)}));
 }
 if(problem==='public-file')chmodSync(planPath,0o644);
 if(problem==='public-directory')chmodSync(dir,0o755);
 if(problem==='symlink'){rmSync(planPath);symlinkSync(join(dir,'receipt.json'),planPath);}
 if(problem==='hardlink')linkSync(planPath,join(dir,'alias.json'));
 if(problem==='fifo'){rmSync(planPath);assert.equal(spawnSync('mkfifo',['-m','600',planPath]).status,0);}
 if(problem==='collision')writeFileSync(output,'retained',{mode:0o600});
 if(['remote','query-override','bad-database'].includes(problem)){
  args.push('--apply-local','--import-config-output',join(dir,'import.json'));
  env={...env,DRIVER_IMPORT_DATABASE_URL:problem==='remote'?'postgresql://synthetic.invalid/fleetpilot_driver_import_test_x':problem==='query-override'?'postgresql://localhost/fleetpilot_driver_import_test_x?host=synthetic.invalid':'postgresql://localhost/production'};
 }
 if(problem==='create-mode')args.push('--mode','CREATE');
 const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:2000,env});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/DRIVER_BINDING_FAILED/);
 assert.doesNotMatch(result.stdout+result.stderr,/synthetic.invalid|Synthetic Private Carrier|synthetic-owner|synthetic-source/);
 if(problem==='collision')assert.equal(readFileSync(output,'utf8'),'retained');
}));
test('local apply is recognized but requires explicit disposable connection before attempting writes',()=>fixture(({dir,args})=>{
 const result=spawnSync(process.execPath,[...args,'--apply-local','--import-config-output',join(dir,'import.json')],{encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.equal(result.status,1);assert.match(result.stderr,/LOCAL_DATABASE_REQUIRED/);
}));
test('binding output refuses a private directory beneath a replaceable ancestor',()=>fixture(({dir,args})=>{
 const parent=join(dir,'writable');mkdirSync(parent,{mode:0o777});chmodSync(parent,0o777);
 const leaf=join(parent,'private');mkdirSync(leaf,{mode:0o700});
 args[args.indexOf('--output')+1]=join(leaf,'output.json');
 const result=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/DRIVER_BINDING_FAILED/);
}));
test('offline receipt preview validates raw hashes without inventing binding mappings',()=>fixture(({dir,args})=>{
 const result=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.equal(result.status,2,result.stderr);
 const report=JSON.parse(readFileSync(join(dir,'output.json'),'utf8'));
 assert.equal(report.summary.companiesToBind,1);
 assert.equal(report.applied,false);assert.equal(report.verified,false);
 assert.equal(report.importConfig,undefined);assert.equal(report.mappings,undefined);
 assert.ok(report.blockers.includes('TARGET_BINDING_AND_AUTHORIZATION_RECHECK_REQUIRED'));
 assert.equal(statSync(join(dir,'output.json')).mode&0o777,0o600);
 assert.doesNotMatch(result.stdout+result.stderr,/Synthetic Private Carrier|synthetic-owner|synthetic-source/);
}));
