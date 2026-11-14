import { createHash } from 'node:crypto';
import { readFileSync, statSync, lstatSync, statfsSync } from 'node:fs';

const GRANT = 'c6ae872a394ebda82b33ed5ee63d5626c0ce9956c89a101507db101c3883a6ec';
const BRANCH = 'work/four-stream-qualification7-xbcif3_h';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function refuse(): never { throw new Error('DISPOSABLE_ISOLATION_REFUSED'); }

// This is an early admission check, not a substitute for trusted HOST Docker
// inspect + namespace inspection. No application/Prisma import belongs here.
export function assertDisposableIsolation(expectedCase: 'tasks' | 'fuel'): void {
  try {
    if (expectedCase !== 'tasks' && expectedCase !== 'fuel') refuse();
    if (process.getuid?.() !== 1000 || process.env.DISPOSABLE_CASE !== expectedCase) refuse();
    for (const key of Object.keys(process.env)) {
      if (key === 'AUTH_SECRET') continue; // fresh synthetic secret pinned by host proof
      if (/(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|CREDENTIAL|PROXY|SSH_|NODE_OPTIONS|NODE_PATH)/i.test(key)) refuse();
      if (/^(AWS_|AZURE_|GOOGLE_|GITHUB_|GH_|PLAID_|QUICKMANAGE_|RESEND_|OPENAI_|ANTHROPIC_|EMAIL_AUTH_FROM|AUTH_GITHUB|TELEGRAM_BOT)/i.test(key)) refuse();
    }
    if (process.env.TELEGRAM_ENABLED !== 'false' || process.env.EMAIL_AUTH_ENABLED !== 'true' ||
        process.env.AUTH_URL !== 'http://127.0.0.1:3100' || process.env.AUTH_TRUST_HOST !== 'true' ||
        process.env.NODE_ENV !== 'production' || process.env.CI !== '1') refuse();
    const url = process.env.DATABASE_URL ?? '';
    if (!/^postgresql:\/\/acceptance:[0-9a-f]{48}@127\.0\.0\.1:5432\/acceptance\?schema=public$/.test(url)) refuse();
    if (!/^[0-9a-f]{64}$/.test(process.env.AUTH_SECRET ?? '')) refuse();
    const path = '/tmp/disposable-proof.json';
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.uid !== 0 || metadata.nlink !== 1 ||
        (metadata.mode & 0o777) !== 0o444 || metadata.size > 100000) refuse();
    const proof = JSON.parse(readFileSync(path, 'utf8'));
    if (proof.version !== 7 || proof.round !== 7 || proof.maximum !== 9 || proof.priorUsed !== 6 ||
        proof.reservedCycle !== 7 || proof.cycle10Authorized !== false || proof.attempt !== 1 || proof.runNumber !== 2 ||
        proof.grantSha256 !== GRANT || proof.repository !== 'shirimov/fleetpilot-tms' ||
        proof.branch !== BRANCH || proof.case !== expectedCase || proof.networkVerified !== true ||
        !/^[0-9a-f]{40}$/.test(proof.eventSha) || proof.eventSha !== process.env.APP_COMMIT_SHA ||
        !/^[0-9]+$/.test(proof.runId) || !/^[0-9a-f]{64}$/.test(proof.dbId) ||
        !/^[0-9a-f]{64}$/.test(proof.appId) || proof.appId === proof.dbId ||
        !/^sha256:[0-9a-f]{64}$/.test(proof.appImage) || !/^sha256:[0-9a-f]{64}$/.test(proof.dbImage) ||
        !Number.isSafeInteger(proof.expiresAt) || Date.now() >= proof.expiresAt ||
        proof.expiresAt - Date.now() > 600000 || proof.databaseUrlHash !== sha(url) ||
        proof.authSecretHash !== sha(process.env.AUTH_SECRET!)) refuse();
    const storage = proof.storage;
    if (process.env.PRIVATE_FILE_STORAGE_ROOT !== '/app/private-files' ||
        storage?.root !== '/app/private-files' || storage.appId !== proof.appId ||
        storage.tmpfs !== true || storage.trustedAncestry !== true || storage.freshEmptyVerified !== true ||
        storage.uid !== 1000 || storage.gid !== 1000 || storage.mode !== '0700' ||
        storage.maxBytes !== 64 * 1024 ** 2) refuse();
    for (const directory of ['/', '/app', '/app/private-files']) {
      const entry = lstatSync(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o022) !== 0) refuse();
      if (directory === '/app/private-files') {
        if (entry.uid !== 1000 || entry.gid !== 1000 || (entry.mode & 0o777) !== 0o700 ||
            statfsSync(directory).type !== 0x1021994) refuse();
      } else if (entry.uid !== 0) refuse();
    }
    // SELECT-only is scoped to acceptance.public in this fresh owned DB;
    // untouched postgres/template database defaults are not a global claim.
    const readerUrl = process.env.DISPOSABLE_READER_DATABASE_URL;
    if (expectedCase === 'fuel' || readerUrl !== undefined || proof.observer !== undefined) {
      if (!readerUrl || !/^postgresql:\/\/acceptance_observer:[0-9a-f]{48}@127\.0\.0\.1:5432\/acceptance\?schema=public$/.test(readerUrl)) refuse();
      const reader = new URL(readerUrl), writer = new URL(url), observer = proof.observer;
      if (reader.username === writer.username || reader.password === writer.password ||
          reader.host !== writer.host || reader.pathname !== writer.pathname || reader.search !== writer.search ||
          observer?.databaseUrlHash !== sha(readerUrl) || observer.writerDatabaseUrlHash !== sha(url) ||
          observer.dbId !== proof.dbId || observer.appId !== proof.appId || observer.netInode !== proof.netInode ||
          observer.login !== 'acceptance_observer' || observer.writerLogin !== 'acceptance' ||
          observer.database !== 'acceptance' || observer.host !== '127.0.0.1' || observer.port !== 5432 ||
          !/^[0-9]+$/.test(observer.databaseOid) || typeof observer.serverStarted !== 'string' ||
          observer.verifiedAfterMigrations !== true || observer.freshSyntheticCredential !== true ||
          observer.aclScope !== 'acceptance.public' || observer.globalReadOnlyClaim !== false ||
          observer.databaseCreateTempDenied !== true || observer.selectOnly !== true || observer.roleFlagsVerified !== true || observer.effectiveGrantsVerified !== true ||
          observer.negativeDmlVerified !== true || observer.catalogVisibilityVerified !== true ||
          observer.defaultReadOnly !== true || observer.passwordAuthenticationVerified !== true) refuse();
    }
    if (String(statSync('/proc/self/ns/net').ino) !== proof.netInode ||
        String(statSync('/proc/1/ns/net').ino) !== proof.netInode) refuse();
    const devices = readFileSync('/proc/self/net/dev', 'utf8').split('\n').slice(2)
      .filter((line) => line.includes(':')).map((line) => line.split(':')[0].trim());
    if (devices.length !== 1 || devices[0] !== 'lo') refuse();
    if (readFileSync('/proc/self/net/route', 'utf8').trim().split('\n').length !== 1) refuse();
    const required = [
      'tests/disposable/playwright.config.ts', 'tests/disposable/assert-isolation.ts',
      'tests/disposable/Dockerfile', 'scripts/ci/disposable-acceptance.sh',
      '.github/workflows/validate-disposable-acceptance.yml',
      'tests/disposable/task-authenticated-acceptance.case.ts',
      'tests/disposable/fuel-authenticated-acceptance.case.ts',
    ];
    if (!Array.isArray(proof.members) || proof.members.length !== required.length ||
        JSON.stringify(proof.members.map((member: { path: string }) => member.path).sort()) !==
        JSON.stringify(required.sort())) refuse();
    for (const member of proof.members) {
      if (typeof member.path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(member.path) ||
          member.path.startsWith('/') || member.path.split('/').includes('..') ||
          !/^[0-9a-f]{64}$/.test(member.sha256) ||
          sha(readFileSync(`/app/${member.path}`)) !== member.sha256) refuse();
    }
  } catch {
    // Missing/malformed external proof is a refusal, never a diagnostic leak.
    refuse();
  }
}
