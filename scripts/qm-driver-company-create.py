#!/usr/bin/env python3
"""Standalone, owner-operated bounded Alpha Company creation; no schema changes.

Python 3.9+ and ordinary owner Mac OpenSSH authentication required. Default is
READ ONLY preflight. --apply explicitly enables one serializable transaction.
Synthetic tests do not establish PostgreSQL or live-host acceptance.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import selectors
import signal
import subprocess
import time

MAX_INPUT = 256 * 1024
MAX_COMPANIES = 7
MAX_MAPPINGS = 100
MAPPING_FIELDS = {'provider', 'accountKey', 'operatingGroupId', 'providerCompanyId',
                  'companyId', 'evidenceReference'}

class CreateError(Exception):
    """Only fixed error codes, never input/database text."""


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CreateError('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def exact_fields(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise CreateError('INVALID_FIELDS')


def text(value, name=False):
    if (not isinstance(value, str) or not 0 < len(value) <= 256 or not value.strip()
            or (not name and value.strip() != value)
            or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value)):
        raise CreateError('INVALID_TEXT')


def validate_plan(raw):
    if len(raw) > MAX_INPUT:
        raise CreateError('INPUT_LIMIT')
    try:
        p = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, RecursionError):
        raise CreateError('INVALID_JSON') from None
    exact_fields(p, {'version', 'intent', 'scope', 'evidenceSha256', 'mappingSha256', 'existingMappings', 'companies'})
    if type(p['version']) is not int or p['version'] != 1 or p['intent'] != 'CREATE_MISSING_QM_COMPANIES':
        raise CreateError('INVALID_INTENT')
    exact_fields(p['scope'], {'provider', 'accountKey', 'operatingGroupId'})
    for v in p['scope'].values():
        text(v)
    if p['scope']['provider'] != 'QUICKMANAGE':
        raise CreateError('INVALID_PROVIDER')
    for k in ('evidenceSha256', 'mappingSha256'):
        if not isinstance(p[k], str) or not re.fullmatch('[0-9a-f]{64}', p[k]):
            raise CreateError('INVALID_HASH')
    for k, cap in [('companies', MAX_COMPANIES), ('existingMappings', MAX_MAPPINGS)]:
        if not isinstance(p[k], list) or not 1 <= len(p[k]) <= cap:
            raise CreateError('INVALID_COUNT')
    sources, references, mapped = set(), set(), set()
    for row in p['existingMappings']:
        exact_fields(row, MAPPING_FIELDS)
        for v in row.values():
            text(v)
        if any(row[k] != v for k, v in p['scope'].items()):
            raise CreateError('MAPPING_SCOPE_CONFLICT')
        if row['providerCompanyId'] in sources or row['evidenceReference'] in references:
            raise CreateError('DUPLICATE_MAPPING')
        sources.add(row['providerCompanyId']); references.add(row['evidenceReference']); mapped.add(row['companyId'])
    ids, names = set(mapped), set()
    for row in p['companies']:
        exact_fields(row, {'providerCompanyId', 'companyId', 'companyName', 'membershipId'})
        text(row['providerCompanyId']); text(row['companyName'], name=True)
        if row['providerCompanyId'] in sources or row['companyName'] in names:
            raise CreateError('DUPLICATE_COMPANY')
        sources.add(row['providerCompanyId']); names.add(row['companyName'])
        for k in ('companyId', 'membershipId'):
            v = row[k]
            if not isinstance(v, str) or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', v):
                raise CreateError('INVALID_PLANNED_UUID')
            if v in ids:
                raise CreateError('DUPLICATE_PLANNED_ID')
            ids.add(v)
    return p


# Only validated base64 (never a name/identifier interpolated into SQL) crosses
# the psql boundary. JSON is decoded as data, not executable SQL.
CHECK_BODY = r'''
DECLARE
  p jsonb := convert_from(decode('__PAYLOAD__', 'base64'), 'UTF8')::jsonb;
  s jsonb := p->'scope';
  r jsonb;
  owner_ids text[];
  owner_id text;
  created_count integer := 0;
  existing_count integer := 0;
BEGIN
  PERFORM 1 FROM "OperatingGroup" WHERE "id" = s->>'operatingGroupId' __LOCK__;
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_MISSING'; END IF;
  IF (SELECT count(*) FROM "ArchiveCompany" a
      WHERE a."provider" = s->>'provider' AND a."accountKey" = s->>'accountKey'
        AND a."operatingGroupId" = s->>'operatingGroupId') <> jsonb_array_length(p->'existingMappings')
  THEN RAISE EXCEPTION 'MAPPING_CHANGED'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p->'existingMappings') LOOP
    IF (SELECT count(*) FROM "ArchiveCompany" a
        JOIN "Company" c ON c."id" = a."companyId"
        JOIN "OperatingGroupCompany" g ON g."companyId" = c."id"
          AND g."operatingGroupId" = a."operatingGroupId"
        WHERE a."id" = r->>'evidenceReference'
          AND a."provider" = r->>'provider' AND a."accountKey" = r->>'accountKey'
          AND a."operatingGroupId" = r->>'operatingGroupId'
          AND a."providerCompanyId" = r->>'providerCompanyId'
          AND a."companyId" = r->>'companyId') <> 1
    THEN RAISE EXCEPTION 'MAPPING_CHANGED'; END IF;
  END LOOP;
  SELECT array_agg(u."id" ORDER BY u."id") INTO owner_ids
    FROM "User" u JOIN "OperatingGroupMembership" gm ON gm."userId" = u."id"
    WHERE u."isActive" = true AND gm."role" = 'OWNER'
      AND gm."operatingGroupId" = s->>'operatingGroupId'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p->'existingMappings') x
        WHERE NOT EXISTS (SELECT 1 FROM "CompanyMembership" cm
          WHERE cm."userId" = u."id" AND cm."companyId" = x->>'companyId' AND cm."role" = 'OWNER'));
  IF COALESCE(array_length(owner_ids, 1), 0) <> 1
    THEN RAISE EXCEPTION 'OWNER_AMBIGUOUS'; END IF;
  owner_id := owner_ids[1];
  __OWNER_CHECK__
  FOR r IN SELECT value FROM jsonb_array_elements(p->'companies') LOOP
    -- Account/source identity is globally unique in the existing Alpha schema;
    -- reject even a conflicting provider/group. This is never name matching.
    IF EXISTS (SELECT 1 FROM "ArchiveCompany" a
      WHERE a."accountKey" = s->>'accountKey' AND a."providerCompanyId" = r->>'providerCompanyId')
    THEN RAISE EXCEPTION 'ARCHIVE_IDENTITY_CONFLICT'; END IF;
    IF EXISTS (SELECT 1 FROM "Company" c
      WHERE c."name" = r->>'companyName' AND c."id" <> r->>'companyId')
    THEN RAISE EXCEPTION 'SAME_NAME_REVIEW'; END IF;
    IF EXISTS (SELECT 1 FROM "CompanyMembership" cm WHERE cm."id" = r->>'membershipId'
      AND (cm."companyId" <> r->>'companyId' OR cm."userId" <> owner_id OR cm."role" <> 'OWNER'))
    THEN RAISE EXCEPTION 'MEMBERSHIP_ID_CONFLICT'; END IF;
    IF EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = r->>'companyId') THEN
      IF (SELECT count(*) FROM "Company" c
        JOIN "OperatingGroupCompany" g ON g."companyId" = c."id"
        JOIN "CompanyMembership" cm ON cm."companyId" = c."id"
        WHERE c."id" = r->>'companyId' AND c."name" = r->>'companyName'
          AND c."dotNumber" IS NULL AND c."mcNumber" IS NULL
          AND g."operatingGroupId" = s->>'operatingGroupId'
          AND cm."id" = r->>'membershipId' AND cm."userId" = owner_id AND cm."role" = 'OWNER') <> 1
        OR (SELECT count(*) FROM "CompanyMembership" cm WHERE cm."companyId" = r->>'companyId') <> 1
      THEN RAISE EXCEPTION 'REPLAY_MISMATCH'; END IF;
      existing_count := existing_count + 1;
    ELSE
      __MISSING__
      created_count := created_count + 1;
    END IF;
  END LOOP;
  __COUNTS__
END;
'''

INSERT_BODY = r'''
      INSERT INTO "Company" ("id", "name", "dotNumber", "mcNumber", "createdAt", "updatedAt")
        VALUES (r->>'companyId', r->>'companyName', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "CompanyMembership" ("id", "userId", "companyId", "role", "createdAt", "updatedAt")
        VALUES (r->>'membershipId', owner_id, r->>'companyId', 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "OperatingGroupCompany" ("operatingGroupId", "companyId", "joinedAt")
        VALUES (s->>'operatingGroupId', r->>'companyId', CURRENT_TIMESTAMP);
'''


def build_sql(plan, apply=False):
    # Revalidate even callers that bypass the CLI.
    raw = json.dumps(plan, ensure_ascii=True, separators=(',', ':')).encode('ascii')
    validate_plan(raw)
    encoded = base64.b64encode(raw).decode('ascii')
    def block(mode):
        body = CHECK_BODY.replace('__PAYLOAD__', encoded)
        body = body.replace('__LOCK__', 'FOR UPDATE' if mode == 'apply' else '')
        body = body.replace('__MISSING__', INSERT_BODY if mode == 'apply' else (
            "RAISE EXCEPTION 'VERIFY_MISSING';" if mode == 'verify' else 'NULL;'))
        body = body.replace('__OWNER_CHECK__', (
            "IF owner_id IS DISTINCT FROM current_setting('qm_company_create.owner') "
            "THEN RAISE EXCEPTION 'VERIFY_OWNER_CHANGED'; END IF;" if mode == 'verify' else
            "PERFORM set_config('qm_company_create.owner', owner_id, false);"))
        body = body.replace('__COUNTS__', 'NULL;' if mode == 'verify' else """
          PERFORM set_config('qm_company_create.created', created_count::text, false);
          PERFORM set_config('qm_company_create.existing', existing_count::text, false);
        """)
        return 'DO $qm_company_create$\n' + body + '$qm_company_create$;\n'
    timeout = "SET LOCAL statement_timeout = '10s';\nSET LOCAL lock_timeout = '3s';\n"
    sql = ('BEGIN ISOLATION LEVEL SERIALIZABLE;\n' if apply else
           'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n') + timeout
    sql += block('apply' if apply else 'preflight')
    if apply:
        sql += 'COMMIT;\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + timeout + block('verify')
    sql += """
SELECT json_build_object(
  'version', 1, 'kind', 'COMPANY_CREATION_RECEIPT',
  'applied', __APPLIED__, 'verified', true,
  'created', current_setting('qm_company_create.created')::integer,
  'existing', current_setting('qm_company_create.existing')::integer,
  'ownerUserId', current_setting('qm_company_create.owner'),
  'companies', (SELECT json_agg(json_build_object(
    'providerCompanyId', r->>'providerCompanyId', 'companyId', r->>'companyId',
    'membershipId', r->>'membershipId') ORDER BY r->>'providerCompanyId')
    FROM jsonb_array_elements(convert_from(decode('__PAYLOAD__', 'base64'), 'UTF8')::jsonb->'companies') r));
ROLLBACK;
""".replace('__PAYLOAD__', encoded).replace('__APPLIED__', 'true' if apply else 'false')
    return sql


# Standalone copies of the reviewed mapping-export public pin/transport.
HOST_PIN = '65.21.187.209 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILdRjmoE0VOqUNw3552jMPviKhsc5U1lBCJNij8Xcn9S\n'

def ssh_command(pin_path):
    # Existing owner SSH config/agent supplies authentication, never this script.
    quoted_pin = '"' + str(pin_path).replace('\\', '\\\\').replace('"', '\\"') + '"'
    options = ['Hostname=65.21.187.209', 'User=fleetpilot', 'Port=22',
               'HostKeyAlias=65.21.187.209', 'StrictHostKeyChecking=yes',
               'HostKeyAlgorithms=ssh-ed25519', 'CheckHostIP=yes',
               'UserKnownHostsFile=' + quoted_pin, 'GlobalKnownHostsFile=/dev/null',
               'KnownHostsCommand=none', 'UpdateHostKeys=no', 'BatchMode=yes',
               'ConnectTimeout=10', 'ConnectionAttempts=1', 'ServerAliveInterval=5',
               'ServerAliveCountMax=2', 'ControlMaster=no', 'ControlPath=none',
               'ControlPersist=no', 'ForwardAgent=no', 'ClearAllForwardings=yes',
               'PermitLocalCommand=no', 'RequestTTY=no', 'LogLevel=ERROR']
    return ['ssh', '-T', *[part for option in options for part in ('-o', option)],
            'fleetpilot@65.21.187.209', 'timeout --signal=TERM --kill-after=2s 45s sh -s']


def bounded_run(command, input_bytes, seconds=60, limit=128 * 1024):
    """Bound wall time and both streams; never expose raw subprocess errors."""
    deadline = time.monotonic() + seconds
    process = None
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        assert process.stdin is not None and process.stdout is not None and process.stderr is not None
        output = bytearray()
        total = 0
        pending = memoryview(input_bytes)
        with selectors.DefaultSelector() as selector:
            for stream in (process.stdout, process.stderr):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, data=stream)
            if pending:
                os.set_blocking(process.stdin.fileno(), False)
                selector.register(process.stdin, selectors.EVENT_WRITE, data=process.stdin)
            else:
                process.stdin.close()
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CreateError('RUNTIME_LIMIT')
                for key, _ in selector.select(min(remaining, .1)):
                    stream = key.data
                    if stream is process.stdin:
                        written = os.write(stream.fileno(), pending[:4096])
                        pending = pending[written:]
                        if not pending:
                            selector.unregister(stream)
                            stream.close()
                    else:
                        chunk = os.read(stream.fileno(), 65536)
                        if not chunk:
                            selector.unregister(stream)
                            continue
                        total += len(chunk)
                        if total > limit:
                            raise CreateError('RESPONSE_LIMIT')
                        if stream is process.stdout:
                            output.extend(chunk)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CreateError('RUNTIME_LIMIT')
            if process.wait(timeout=remaining) != 0:
                raise CreateError('REMOTE_FAILED')
        return bytes(output)
    except subprocess.TimeoutExpired:
        raise CreateError('RUNTIME_LIMIT') from None
    except OSError:
        raise CreateError('TRANSPORT_FAILED') from None
    finally:
        if process is not None:
            # Also terminate local children (e.g. a configured SSH proxy).
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream:
                    stream.close()




def safe_path(path):
    path = Path(path).expanduser().absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise CreateError('UNSAFE_PATH')
    if any((p / '.git').exists() for p in (path, *path.parents)):
        raise CreateError('PRIVATE_ARTIFACT_INSIDE_GIT')
    return path


def read_plan(path):
    path = safe_path(path)
    # O_NONBLOCK prevents a FIFO from hanging before fstat rejects it.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != os.getuid() or before.st_mode & 0o077):
            raise CreateError('UNSAFE_INPUT_FILE')
        if before.st_size > MAX_INPUT:
            raise CreateError('INPUT_LIMIT')
        raw = stream.read(MAX_INPUT + 1)
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_nlink) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink):
            raise CreateError('INPUT_CHANGED')
    return raw, validate_plan(raw)


def new_output_dir(path):
    path = safe_path(path)
    path.mkdir(mode=0o700, parents=False, exist_ok=False)
    path.chmod(0o700)
    return path


def exclusive_write(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(content)
        output.flush()
        os.fsync(output.fileno())


def remote_script(plan, apply=False):
    readonly = 'off' if apply else 'on'
    return r'''set -eu
[ "$(hostname)" = ubuntu-8gb-hel1-2 ] || exit 41
containers=$(docker ps --filter 'label=com.docker.compose.project.working_dir=/opt/fleetpilot' --filter 'label=com.docker.compose.service=db' --format '{{.ID}}')
set -f
set -- $containers
[ "$#" -eq 1 ] || exit 42
case "$1" in ''|*[!0-9a-f]*) exit 43;; esac
# Read only the internal DB identity; no docker inspect/env output.
docker exec -i "$1" sh -c 'exec env PGOPTIONS="-c default_transaction_read_only=__READONLY__ -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000 -c search_path=public,pg_catalog -c client_min_messages=warning" psql -X -w -qAt -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:?}" -d "${POSTGRES_DB:?}"' <<'QM_COMPANY_SQL'
'''.replace('__READONLY__', readonly) + build_sql(plan, apply) + 'QM_COMPANY_SQL\n'


def validate_receipt(raw, plan, apply):
    if len(raw) > 128 * 1024:
        raise CreateError('RESPONSE_LIMIT')
    try:
        result = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, RecursionError):
        raise CreateError('INVALID_RECEIPT') from None
    exact_fields(result, {'version', 'kind', 'applied', 'verified', 'created', 'existing', 'ownerUserId', 'companies'})
    if (type(result['version']) is not int or result['version'] != 1
            or result['kind'] != 'COMPANY_CREATION_RECEIPT'
            or result['applied'] is not apply or result['verified'] is not True):
        raise CreateError('INVALID_RECEIPT')
    text(result['ownerUserId'])
    for field in ('created', 'existing'):
        if type(result[field]) is not int or not 0 <= result[field] <= len(plan['companies']):
            raise CreateError('INVALID_RECEIPT_COUNT')
    if result['created'] + result['existing'] != len(plan['companies']):
        raise CreateError('INVALID_RECEIPT_COUNT')
    expected = [{k: row[k] for k in ('providerCompanyId', 'companyId', 'membershipId')} for row in plan['companies']]
    if not isinstance(result['companies'], list) or len(result['companies']) != len(expected):
        raise CreateError('INVALID_RECEIPT_IDS')
    # Sort canonical JSON rather than trusting any unvalidated response key.
    if sorted(json.dumps(x, sort_keys=True) for x in result['companies']) != sorted(json.dumps(x, sort_keys=True) for x in expected):
        raise CreateError('INVALID_RECEIPT_IDS')
    result['wouldCreate'] = 0 if apply else result['created']
    if not apply:
        result['created'] = 0
    result['verification'] = 'POST_COMMIT_READ_ONLY' if apply else 'READ_ONLY_PREFLIGHT'
    return result


def run(plan_path, output_dir, apply=False):
    raw, plan = read_plan(plan_path)
    out = new_output_dir(output_dir)
    # Preserve exact input bytes, never reserialize the immutable evidence plan.
    exclusive_write(out / 'plan.json', raw)
    sha = hashlib.sha256(raw).hexdigest()
    exclusive_write(out / 'plan.sha256', (sha + '\n').encode('ascii'))
    pin = out / 'known_hosts'
    exclusive_write(pin, HOST_PIN.encode('ascii'))
    started = False
    try:
        script = remote_script(plan, apply).encode('ascii')
        if len(script) > 3 * 1024 * 1024:
            raise CreateError('REQUEST_LIMIT')
        # No retries: an interrupted connection can conceal a successful commit.
        started = True
        payload = bounded_run(ssh_command(pin), script)
        receipt = validate_receipt(payload, plan, apply)
        receipt.update(planSha256=sha, evidenceSha256=plan['evidenceSha256'],
                       mappingSha256=plan['mappingSha256'], scope=plan['scope'])
        exclusive_write(out / 'receipt.json', (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode('ascii'))
        return {k: receipt[k] for k in ('applied', 'verified', 'created', 'existing', 'wouldCreate')}
    except (Exception, KeyboardInterrupt):
        if apply and started:
            # Includes post-commit verification, response parsing and local report
            # failures. Do not report rollback unless it was actually established.
            raise CreateError('APPLY_OUTCOME_UNCERTAIN_NO_BLIND_RETRY_USE_READONLY_PREFLIGHT') from None
        raise
    finally:
        try:
            pin.unlink(missing_ok=True)
        except OSError:
            if apply and started:
                raise CreateError('APPLY_OUTCOME_UNCERTAIN_NO_BLIND_RETRY_USE_READONLY_PREFLIGHT') from None
            raise CreateError('LOCAL_CLEANUP_FAILED') from None


def main(argv=None):
    import argparse
    import sys
    class SafeParser(argparse.ArgumentParser):
        def error(self, message):
            raise CreateError('INVALID_ARGUMENTS')
    parser = SafeParser(description=(
        'Standalone owner-operated Alpha company creation. Python 3.9+ and existing '
        'ordinary Mac SSH identity/agent required. Default: READ ONLY preflight. '
        '--apply: atomic Company + OWNER CompanyMembership + OperatingGroupCompany only. '
        'No ArchiveCompany binding or financial writes, migrations, or deployment. '
        'Resolved membership owner is NOT an app-authenticated actor. '
        'Real PostgreSQL acceptance has NOT been exercised by synthetic tests. '
        'On uncertain outcomes, preserve the same plan and run read-only preflight; never blindly retry apply.'))
    parser.add_argument('--plan', required=True, help='Private 0600 regular JSON plan outside Git; no links')
    parser.add_argument('--output-dir', required=True, help='NEW directory outside Git under existing parent (0700); exclusive 0600 artifacts')
    parser.add_argument('--apply', action='store_true', help='Explicitly enable atomic creation (otherwise read only)')
    report_after_apply = False
    try:
        args = parser.parse_args(argv)
        result = run(args.plan, args.output_dir, args.apply)
        report_after_apply = args.apply
        print(json.dumps(result, sort_keys=True))
        return 0
    except CreateError as error:
        print('COMPANY_CREATE_FAILED: ' + str(error), file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        code = ('APPLY_OUTCOME_UNCERTAIN_NO_BLIND_RETRY_USE_READONLY_PREFLIGHT'
                if report_after_apply else 'LOCAL_FAILURE')
        print('COMPANY_CREATE_FAILED: ' + code, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
