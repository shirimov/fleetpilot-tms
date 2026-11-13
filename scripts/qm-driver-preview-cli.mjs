import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, realpathSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { preview } from './qm-driver-preview.mjs';

function privateDirectory(path) {
  const directory = realpathSync(path);
  const info = statSync(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) throw new Error('PRIVATE_DIRECTORY_REQUIRED');
  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) throw new Error('OUTSIDE_GIT_REQUIRED');
    if (dirname(current) === current) break;
  }
  return directory;
}
function readPrivate(path) {
  privateDirectory(dirname(resolve(path)));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid() || info.size > 16 * 1024 * 1024) throw new Error('PRIVATE_BOUNDED_FILE_REQUIRED');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--input' || args[2] !== '--mapping' || args[4] !== '--output') throw new Error('INVALID_ARGUMENTS');
  const input = readPrivate(args[1]);
  const mapping = readPrivate(args[3]);
  const result = preview(JSON.parse(input.toString('utf8')), JSON.parse(mapping.toString('utf8')));
  result.inputSha256 = createHash('sha256').update(input).digest('hex');
  result.mappingSha256 = createHash('sha256').update(mapping).digest('hex');
  const output = resolve(args[5]);
  privateDirectory(dirname(output));
  const fd = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); } finally { closeSync(fd); }
  // Counts only. Never print input, source identities, pay or filesystem errors.
  process.stdout.write(JSON.stringify(result.summary) + '\n');
  process.exitCode = 2; // Preview exists; canonical insertion is blocked.
} catch {
  process.stderr.write('DRIVER_PREVIEW_FAILED: validate private files, format, identities, coverage and output path.\n');
  process.exitCode = 1;
}
