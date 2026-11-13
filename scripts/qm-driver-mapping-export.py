#!/usr/bin/env python3
"""Owner-operated read-only Alpha mapping export. Never supplies SSH credentials."""
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

# Public retained pin, NOT a credential. Fail closed if Alpha rotates this key.
HOST_PIN = '65.21.187.209 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILdRjmoE0VOqUNw3552jMPviKhsc5U1lBCJNij8Xcn9S\n'
REMOTE_SCRIPT = r'''set -eu
[ "$(hostname)" = ubuntu-8gb-hel1-2 ] || exit 41
containers=$(docker ps --filter 'label=com.docker.compose.project.working_dir=/opt/fleetpilot' --filter 'label=com.docker.compose.service=db' --format '{{.ID}}')
set -f
set -- $containers
[ "$#" -eq 1 ] || exit 42
case "$1" in ''|*[!0-9a-f]*) exit 43;; esac
docker exec -i "$1" sh -c 'exec env PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=10000" psql -X -w -qAt -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:?}" -d "${POSTGRES_DB:?}"' <<'QM_MAPPING_SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT COALESCE(json_agg(json_build_object(
  'provider', "provider",
  'accountKey', "accountKey",
  'operatingGroupId', "operatingGroupId",
  'providerCompanyId', "providerCompanyId",
  'companyId', "companyId",
  'evidenceReference', "id"
) ORDER BY "accountKey", "providerCompanyId", "id"), '[]'::json)
FROM "ArchiveCompany"
WHERE "provider" = 'QUICKMANAGE';
ROLLBACK;
QM_MAPPING_SQL
'''


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
            'fleetpilot@65.21.187.209', 'timeout --signal=TERM --kill-after=2s 25s sh -s']


def bounded_run(command, input_bytes, seconds=40, limit=4 * 1024 * 1024):
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
                    raise ExportError('RUNTIME_LIMIT')
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
                            raise ExportError('RESPONSE_LIMIT')
                        if stream is process.stdout:
                            output.extend(chunk)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ExportError('RUNTIME_LIMIT')
            if process.wait(timeout=remaining) != 0:
                raise ExportError('REMOTE_READ_FAILED')
        return bytes(output)
    except subprocess.TimeoutExpired:
        raise ExportError('RUNTIME_LIMIT') from None
    except OSError:
        raise ExportError('TRANSPORT_FAILED') from None
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


class ExportError(Exception):
    """Only fixed, non-sensitive error codes may cross the CLI boundary."""


FIELDS = {'provider', 'accountKey', 'operatingGroupId', 'providerCompanyId',
          'companyId', 'evidenceReference'}
MAX_OUTPUT = 4 * 1024 * 1024
MAX_ROWS = 10000


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ExportError('INVALID_RESPONSE')
        result[key] = value
    return result


def validate_payload(payload):
    if len(payload) > MAX_OUTPUT:
        raise ExportError('RESPONSE_LIMIT')
    try:
        rows = json.loads(payload.decode('utf-8'), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, RecursionError):
        raise ExportError('INVALID_RESPONSE') from None
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise ExportError('INVALID_RESPONSE')
    scopes, references = {}, {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise ExportError('INVALID_RESPONSE')
        for value in row.values():
            if (not isinstance(value, str) or not 0 < len(value) <= 256
                    or value.strip() != value
                    or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value)):
                raise ExportError('INVALID_IDENTIFIER')
        if row['provider'] != 'QUICKMANAGE':
            raise ExportError('INVALID_PROVIDER')
        key = (row['accountKey'], row['providerCompanyId'])
        ref = row['evidenceReference']
        if ((key in scopes and scopes[key] != row)
                or (ref in references and references[ref] != row)):
            raise ExportError('CONFLICTING_MAPPING')
        scopes[key], references[ref] = row, row
    return rows


def exclusive_write(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def export_mappings(output_dir):
    """Create a NEW private directory outside Git; never overwrite any artifact."""
    output_dir = Path(output_dir).expanduser().absolute()
    pin = output_dir / 'known_hosts'
    created = False
    try:
        # Reject symlink components, including dangling output symlinks.
        if any(p.is_symlink() for p in (output_dir, *output_dir.parents)):
            raise ExportError('UNSAFE_OUTPUT_DIRECTORY')
        if any((p / '.git').exists() for p in (output_dir, *output_dir.parents)):
            raise ExportError('OUTPUT_INSIDE_GIT')
        output_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
        created = True
        output_dir.chmod(0o700)
        exclusive_write(pin, HOST_PIN.encode('ascii'))
        payload = bounded_run(ssh_command(pin), REMOTE_SCRIPT.encode('ascii'))
        rows = validate_payload(payload)
        exclusive_write(output_dir / 'mappings.json',
                        (json.dumps(rows, ensure_ascii=True, indent=2) + '\n').encode('utf-8'))
        return {'rows': len(rows), 'accounts': len({r['accountKey'] for r in rows}),
                'operatingGroups': len({r['operatingGroupId'] for r in rows}),
                'bindings': len({(r['accountKey'], r['providerCompanyId']) for r in rows})}
    except OSError:
        raise ExportError('LOCAL_OUTPUT_FAILED') from None
    finally:
        if created:
            pin.unlink(missing_ok=True)


def main(argv=None):
    import argparse
    import sys

    class SafeParser(argparse.ArgumentParser):
        def error(self, message):
            raise ExportError('INVALID_ARGUMENTS')

    parser = SafeParser(description=(
        'Owner-operated READ ONLY Alpha QM binding export. Requires Python 3.9+, '
        'OpenSSH and the owner\'s already configured ordinary Mac SSH identity/agent. '
        'Never use restricted preflight keys or copy private keys. '
        'Remote authentication is NOT verified by synthetic tests. '
        'No deployment/import/write is performed.'))
    parser.add_argument('--output-dir', required=True,
                        help='NEW directory outside Git under an existing parent; creates 0700 directory and 0600 mappings.json')
    try:
        args = parser.parse_args(argv)
        counts = export_mappings(args.output_dir)
        print(json.dumps(counts, sort_keys=True))
        return 0
    except ExportError as error:
        print('EXPORT_FAILED: ' + str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, RuntimeError):
        print('EXPORT_FAILED: LOCAL_FAILURE', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('EXPORT_FAILED: INTERRUPTED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
