import {lstatSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {requireImport} from '../src/lib/fleet/qm-driver-import.mjs';

// Fail closed instead of validating realpath and later opening a different path.
// Every component must be non-symlink and protected against other-user rename.
// Root-owned sticky temporary directories are safe ancestors of user-owned leaves.
export function privateDirectory(path) {
 const directory=resolve(path),uid=process.getuid();
 for(let current=directory;;current=dirname(current)) {
  const info=lstatSync(current);
  requireImport(info.isDirectory()&&!info.isSymbolicLink(),'PRIVATE_DIRECTORY_REQUIRED');
  if(current===directory) requireImport(info.uid===uid&&(info.mode&0o077)===0,'PRIVATE_DIRECTORY_REQUIRED');
  requireImport(info.uid===uid||info.uid===0,'UNTRUSTED_DIRECTORY_OWNER');
  requireImport((info.mode&0o022)===0||(current!==directory&&info.uid===0&&(info.mode&0o1000)!==0),'REPLACEABLE_DIRECTORY_ANCESTOR');
  requireImport(!existsSync(join(current,'.git')),'OUTSIDE_GIT_REQUIRED');
  if(dirname(current)===current)break;
 }
}
