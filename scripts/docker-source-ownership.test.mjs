import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8');
const stage = name => dockerfile.split(new RegExp(`^FROM .* AS ${name}$`, 'm'))[1]?.split(/^FROM /m)[0];

test('builder assigns the complete copied source graph to the migrator runtime owner', () => {
  assert.match(stage('builder'), /^COPY --chown=node:node \. \.$/m);
  assert.match(stage('migrator'), /^USER node$/m);
  assert.match(dockerfile, /^FROM builder AS migrator$/m);
  assert.doesNotMatch(dockerfile, /chmod\s+(?:-R\s+)?777/);
});

test('runner retains ownership on every builder copy and both services retain readonly nonroot runtime', () => {
  const copies = stage('runner').split('\n').filter(line => line.startsWith('COPY '));
  assert.equal(copies.length, 3);
  for (const line of copies) assert.match(line, /^COPY --from=builder --chown=fleetpilot:fleetpilot /);
  assert.match(stage('runner'), /^USER fleetpilot$/m);
  const compose = readFileSync(new URL('docker-compose.staging.yml', root), 'utf8');
  for (const name of ['app', 'migrate']) {
    const service = compose.split(`\n  ${name}:\n`)[1].split(/\n  [a-z][\w-]*:\n/)[0];
    assert.match(service, /read_only: true/);
    assert.doesNotMatch(service, /^    user:/m);
  }
});

test('build context continues excluding environment and private runtime data', () => {
  const ignored = readFileSync(new URL('.dockerignore', root), 'utf8').split('\n');
  for (const name of ['.git', '.env', '.env.*', '.data', '.deployment-state', 'node_modules']) assert.ok(ignored.includes(name), name);
  assert.deepEqual(ignored.filter(line => line.startsWith('!')), ['!.env.staging.example']);
});

// Explicit opt-in: existing LOCAL immutable image only, no build/pull/host mounts.
// Uses real Linux DAC and real Node ESM against unchanged PUBLIC source bytes.
// This is not a Docker build or a production-image acceptance test.
const image = process.env.LOCAL_PERMISSION_TEST_IMAGE;
test('real nonroot ESM reproduces EACCES and ownership repair covers transitive sources', { skip: !image }, () => {
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const docker = ['--host', 'unix:///var/run/docker.sock'];
  const inspect = spawnSync('docker', [...docker, 'image', 'inspect', '--format', '{{json (index .Config "Volumes")}}', image], { encoding: 'utf8', timeout: 10000 });
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(inspect.stdout.trim(), 'null', 'fixture image must not declare anonymous volumes');
  const names = [
    'scripts/qm-driver-alpha-import-cli.mjs',
    'src/lib/fleet/qm-driver-alpha-import.mjs',
    'src/lib/fleet/qm-driver-import.mjs',
    'src/lib/fleet/qm-driver-binding.mjs',
    'src/lib/fleet/qm-driver-company.mjs',
    'src/lib/fleet/qm-driver-store.mjs',
  ];
  const files = Object.fromEntries(names.map(name => [name, readFileSync(new URL(name, root), 'utf8')]));
  const program = `
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const files=${JSON.stringify(files)};
const base='/tmp/source-permissions';
fs.mkdirSync(base,{mode:0o755});
const dirs=new Set([base]);
for(const [name,bytes] of Object.entries(files)) {
 const dest=path.join(base,name);
 fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o755});
 for(let p=path.dirname(dest);p.startsWith(base);p=path.dirname(p)) dirs.add(p);
 fs.writeFileSync(dest,bytes,{mode:0o600});
}
function run(){return spawnSync(process.execPath,[path.join(base,'scripts/qm-driver-alpha-import-cli.mjs')],{uid:1000,gid:1000,env:{PATH:'/usr/local/bin:/usr/bin:/bin'},encoding:'utf8',timeout:10000});}
function denied(result,label){assert.equal(result.status,1,label);assert.match(result.stderr,/EACCES/);assert.match(result.stderr,/permission denied/);}
denied(run(),'root-owned 0600 entrypoint');
console.log('ROOT_0600_ENTRYPOINT_EACCES');
fs.chownSync(path.join(base,'scripts/qm-driver-alpha-import-cli.mjs'),1000,1000);
denied(run(),'single-leaf correction leaves sibling imports unreadable');
console.log('SINGLE_LEAF_FIX_STILL_EACCES');
fs.chownSync(path.join(base,'scripts/qm-driver-alpha-import-cli.mjs'),0,0);
// Materialize the ownership specified by the actual Dockerfile COPY instruction.
const corrected=${/^COPY --chown=node:node \. \.$/m.test(stage('builder'))};
if(corrected){for(const name of Object.keys(files)) fs.chownSync(path.join(base,name),1000,1000);for(const d of [...dirs].sort((a,b)=>b.length-a.length)){fs.chmodSync(d,0o700);fs.chownSync(d,1000,1000);}}
const result=run();
assert.equal(result.status,2,result.stderr);
assert.match(result.stderr,/ALPHA_DRIVER_IMPORT_REFUSED: explicit --preview or authorized --apply-alpha required/);
assert.doesNotMatch(result.stderr,/EACCES/);
const verify=spawnSync(process.execPath,['-e',"const fs=require('node:fs'),assert=require('node:assert/strict');const files="+JSON.stringify(files)+";for(const [name,bytes] of Object.entries(files)){const p="+JSON.stringify(base)+"+'/'+name;assert.equal(fs.statSync(p).mode&0o777,0o600);assert.equal(fs.readFileSync(p,'utf8'),bytes);}for(const d of "+JSON.stringify([...dirs])+")assert.equal(fs.statSync(d).mode&0o777,0o700);"],{uid:1000,gid:1000,env:{},encoding:'utf8',timeout:10000});
assert.equal(verify.status,0,verify.stderr);
console.log('FULL_GRAPH_PRIVATE_MODES_NONROOT_ESM_LOADED uid=1000 node='+process.version);
`;
  const name = `driver-permission-test-${randomUUID()}`;
  let result;
  try {
    result = spawnSync('docker', [...docker, 'run', '--rm', '--name', name, '--pull=never', '--network=none', '--read-only', '--memory=128m', '--cpus=0.5', '--pids-limit=32', '--cap-drop=ALL', '--cap-add=CHOWN', '--cap-add=SETUID', '--cap-add=SETGID', '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777', '--user=0:0', '--entrypoint=node', '-i', image, '-'], { input: program, encoding: 'utf8', timeout: 45000, maxBuffer: 65536 });
  } finally {
    // Exact disposable fixture name only; never touch any other container.
    const found = spawnSync('docker', [...docker, 'container', 'ls', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(found.status, 0, found.stderr);
    if (found.stdout.trim() === name) {
      const removed = spawnSync('docker', [...docker, 'rm', '-f', name], { encoding: 'utf8', timeout: 10000 });
      assert.equal(removed.status, 0, removed.stderr);
    }
    const remaining = spawnSync('docker', [...docker, 'container', 'ls', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(remaining.status, 0, remaining.stderr);
    assert.equal(remaining.stdout.trim(), '', 'fixture container removal verified');
  }
  process.stdout.write(result.stdout || '');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
