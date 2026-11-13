"""Synthetic unit/protocol fixtures ONLY — NOT Alpha evidence. No network."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRATCH = Path(os.environ.get('TMPDIR', Path.home() / '.cache'))
SCRATCH.mkdir(parents=True, exist_ok=True)

SCRIPT = Path(__file__).with_name('qm-driver-mapping-export.py')


def load_exporter():
    spec = importlib.util.spec_from_file_location('mapping_export', SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture(**changes):
    return dict(provider='QUICKMANAGE', accountKey='synthetic-account',
                operatingGroupId='synthetic-group', providerCompanyId='0007',
                companyId='synthetic-company', evidenceReference='synthetic-archive', **changes)


class SyntheticValidationTests(unittest.TestCase):
    def test_exact_allowlisted_mapping_preserves_leading_zero_id(self):
        self.assertTrue(SCRIPT.exists(), 'exporter implementation missing')
        module = load_exporter()
        rows = [fixture()]
        self.assertEqual(module.validate_payload(json.dumps(rows).encode()), rows)

    def test_empty_and_bounded_collections(self):
        module = load_exporter()
        self.assertEqual(module.validate_payload(b'[]'), [])
        with mock.patch.object(module, 'MAX_ROWS', 1):
            with self.assertRaises(module.ExportError):
                module.validate_payload(json.dumps([fixture(), fixture()]).encode())
        with mock.patch.object(module, 'MAX_OUTPUT', 2):
            with self.assertRaises(module.ExportError):
                module.validate_payload(b'[ ]')

    def test_rejects_invalid_shape_ids_and_conflicts_without_echo(self):
        module = load_exporter()
        base = fixture()
        invalid = [{}, [dict(base, extra='SECRET')], [dict(base, provider='OTHER')],
                   [dict(base, companyId=None)], [dict(base, companyId=12)],
                   [dict(base, companyId=' padded ')], [dict(base, companyId='x\n')],
                   [dict(base, companyId='')], [dict(base, companyId='x'*257)],
                   [base, dict(base, companyId='conflict')],
                   [base, dict(base, operatingGroupId='other-group')],
                   [base, dict(base, evidenceReference='other-reference')],
                   [base, dict(base, providerCompanyId='other-company')]]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(module.ExportError):
                module.validate_payload(json.dumps(value).encode())
        for payload in [b'not JSON SECRET', b'[{"provider":"QUICKMANAGE","provider":"QUICKMANAGE"}]', b'\xff']:
            with self.assertRaises(module.ExportError) as caught:
                module.validate_payload(payload)
            self.assertNotIn('SECRET', str(caught.exception))
        self.assertEqual(module.validate_payload(json.dumps([base, base]).encode()), [base, base])


class SyntheticTransportTests(unittest.TestCase):
    def test_pinned_ssh_and_read_only_protocol(self):
        module = load_exporter()
        self.assertTrue(hasattr(module, 'ssh_command'), 'transport implementation missing')
        command = module.ssh_command(Path('/synthetic/private/pin'))
        for option in ['StrictHostKeyChecking=yes', 'BatchMode=yes',
                       'UserKnownHostsFile="/synthetic/private/pin"', 'GlobalKnownHostsFile=/dev/null',
                       'ControlPath=none', 'ForwardAgent=no', 'Hostname=65.21.187.209',
                       'HostKeyAlias=65.21.187.209', 'User=fleetpilot']:
            self.assertIn(option, command)
        self.assertIn('fleetpilot@65.21.187.209', command)
        self.assertIn('BEGIN READ ONLY;', module.REMOTE_SCRIPT)
        self.assertIn("SET LOCAL statement_timeout = '10s';", module.REMOTE_SCRIPT)
        self.assertIn('ROLLBACK;', module.REMOTE_SCRIPT)
        self.assertIn('com.docker.compose.project.working_dir=/opt/fleetpilot', module.REMOTE_SCRIPT)
        self.assertIn('com.docker.compose.service=db', module.REMOTE_SCRIPT)
        self.assertIn('ubuntu-8gb-hel1-2', module.REMOTE_SCRIPT)
        for forbidden in ['SELECT *', 'docker inspect', 'providerCompanyName', 'UPDATE ', 'INSERT ', 'DELETE ']:
            self.assertNotIn(forbidden, module.REMOTE_SCRIPT)
        self.assertIn('AAAAC3NzaC1lZDI1NTE5AAAAILdRjmoE0VOqUNw3552jMPviKhsc5U1lBCJNij8Xcn9S', module.HOST_PIN)

    def test_bounded_child_success_failure_timeout_output(self):
        module = load_exporter()
        self.assertTrue(hasattr(module, 'bounded_run'), 'bounded runtime missing')
        self.assertEqual(module.bounded_run([sys.executable, '-c', 'print("[]")'], b'', 2, 100), b'[]\n')
        cases = [('import sys; print("PRIVATE",file=sys.stderr); sys.exit(2)', 2, 100),
                 ('import time; time.sleep(3)', .1, 100),
                 ('print("x"*10000)', 2, 100),
                 ('import sys; sys.stderr.write("x"*10000)', 2, 100)]
        for code, seconds, limit in cases:
            with self.assertRaises(module.ExportError) as caught:
                module.bounded_run([sys.executable, '-c', code], b'', seconds, limit)
            self.assertNotIn('PRIVATE', str(caught.exception))


    def test_local_shell_protocol_with_synthetic_docker_and_psql(self):
        module = load_exporter()
        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp:
            root = Path(temp)
            def executable(name, source):
                path = root / name
                path.write_text('#!' + sys.executable + '\n' + source)
                path.chmod(0o700)
            executable('hostname', 'import os; print(os.environ["SYNTHETIC_HOST"])')
            executable('docker', '''import os, sys, subprocess
from pathlib import Path
args = sys.argv[1:]
if args[0] == 'ps':
    assert args == ['ps', '--filter', 'label=com.docker.compose.project.working_dir=/opt/fleetpilot', '--filter', 'label=com.docker.compose.service=db', '--format', '{{.ID}}']
    print(os.environ['SYNTHETIC_CONTAINERS'])
elif args[:3] == ['exec', '-i', 'abcdef012345']:
    Path(os.environ['SYNTHETIC_EXEC_MARKER']).write_text('exec reached')
    assert args[3:5] == ['sh', '-c'] and len(args) == 6
    sys.exit(subprocess.call(args[3:]))
else:
    sys.exit(92)
''')
            executable('psql', '''import json, os, sys
args = sys.argv[1:]
assert args == ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'SYNTHETIC_USER', '-d', 'SYNTHETIC_DB']
assert os.environ['PGOPTIONS'] == '-c default_transaction_read_only=on -c statement_timeout=10000'
sql = sys.stdin.read()
assert sql.startswith('BEGIN READ ONLY;\\n') and sql.endswith('ROLLBACK;\\n')
assert sql.count('SELECT ') == 1 and 'WHERE "provider" = \\'QUICKMANAGE\\'' in sql
assert "'evidenceReference', \\"id\\"" in sql
print(os.environ['SYNTHETIC_JSON'])
''')
            marker = root / 'exec-marker'
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       SYNTHETIC_HOST='ubuntu-8gb-hel1-2', SYNTHETIC_CONTAINERS='abcdef012345',
                       SYNTHETIC_EXEC_MARKER=str(marker), SYNTHETIC_JSON=json.dumps([fixture()]),
                       POSTGRES_USER='SYNTHETIC_USER', POSTGRES_DB='SYNTHETIC_DB')
            with mock.patch.dict(os.environ, env, clear=True):
                self.assertEqual(module.validate_payload(module.bounded_run(['/bin/sh', '-s'], module.REMOTE_SCRIPT.encode())), [fixture()])
                self.assertTrue(marker.exists())
                marker.unlink()
                for host, containers in [('wrong-host', 'abcdef012345'),
                                         ('ubuntu-8gb-hel1-2', ''),
                                         ('ubuntu-8gb-hel1-2', 'abcdef012345\n123abc'),
                                         ('ubuntu-8gb-hel1-2', 'not-an-id')]:
                    os.environ['SYNTHETIC_HOST'] = host
                    os.environ['SYNTHETIC_CONTAINERS'] = containers
                    with self.assertRaises(module.ExportError):
                        module.bounded_run(['/bin/sh', '-s'], module.REMOTE_SCRIPT.encode())
                    self.assertFalse(marker.exists())


class SyntheticOutputTests(unittest.TestCase):
    def test_private_exclusive_export_and_counts_only(self):
        module = load_exporter()
        self.assertTrue(hasattr(module, 'export_mappings'), 'private export missing')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp:
            target = Path(temp) / 'owner-only'
            def synthetic_transport(command, payload):
                pin = target / 'known_hosts'
                self.assertEqual(pin.read_text(), module.HOST_PIN)
                self.assertEqual(pin.stat().st_mode & 0o777, 0o600)
                self.assertEqual(payload, module.REMOTE_SCRIPT.encode())
                return json.dumps([fixture()]).encode()
            with mock.patch.object(module, 'bounded_run', side_effect=synthetic_transport) as runner:
                counts = module.export_mappings(target)
                self.assertEqual(counts, {'rows': 1, 'accounts': 1, 'operatingGroups': 1, 'bindings': 1})
                self.assertEqual(json.loads((target / 'mappings.json').read_text()), [fixture()])
                self.assertEqual(target.stat().st_mode & 0o777, 0o700)
                self.assertEqual((target / 'mappings.json').stat().st_mode & 0o777, 0o600)
                self.assertFalse((target / 'known_hosts').exists())
                with self.assertRaises(module.ExportError):
                    module.export_mappings(target)
                self.assertEqual(runner.call_count, 1)

    def test_reject_git_symlink_and_failed_collection_leaves_no_mapping(self):
        module = load_exporter()
        self.assertTrue(hasattr(module, 'export_mappings'), 'private export missing')
        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp:
            parent = Path(temp)
            repo = parent / 'repo'
            repo.mkdir()
            (repo / '.git').write_text('synthetic worktree marker')
            (parent / 'link').symlink_to(repo, target_is_directory=True)
            with mock.patch.object(module, 'bounded_run') as runner:
                for target in [repo / 'output', parent / 'link' / 'output']:
                    with self.assertRaises(module.ExportError):
                        module.export_mappings(target)
                runner.assert_not_called()
            with mock.patch.object(module, 'bounded_run', return_value=b'PRIVATE INVALID JSON'):
                target = parent / 'failed'
                with self.assertRaises(module.ExportError):
                    module.export_mappings(target)
                self.assertFalse((target / 'mappings.json').exists())
                self.assertFalse((target / 'known_hosts').exists())


class SyntheticCliTests(unittest.TestCase):
    def test_cli_uses_existing_route_and_never_echoes_remote_errors(self):
        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp:
            root = Path(temp)
            fake = root / 'ssh'
            fake.write_text('#!' + sys.executable + '\n' + '''import os, sys
from pathlib import Path
assert 'StrictHostKeyChecking=yes' in sys.argv
assert 'fleetpilot@65.21.187.209' in sys.argv
assert 'BEGIN READ ONLY;' in sys.stdin.read()
if os.environ['SYNTHETIC_FAIL'] == '1':
    print('SENSITIVE_AUTH_DETAIL', file=sys.stderr)
    sys.exit(255)
print(os.environ['SYNTHETIC_JSON'])
''')
            fake.chmod(0o700)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       SYNTHETIC_FAIL='0', SYNTHETIC_JSON=json.dumps([fixture()]))
            success = subprocess.run([sys.executable, str(SCRIPT), '--output-dir', str(root / 'success')],
                                     env=env, capture_output=True, timeout=5)
            self.assertEqual(success.returncode, 0, success.stderr)
            self.assertEqual(success.stdout, b'{"accounts": 1, "bindings": 1, "operatingGroups": 1, "rows": 1}\n')
            self.assertEqual(success.stderr, b'')
            env['SYNTHETIC_FAIL'] = '1'
            failure = subprocess.run([sys.executable, str(SCRIPT), '--output-dir', str(root / 'failure')],
                                     env=env, capture_output=True, timeout=5)
            self.assertNotEqual(failure.returncode, 0)
            self.assertEqual(failure.stdout, b'')
            self.assertEqual(failure.stderr, b'EXPORT_FAILED: REMOTE_READ_FAILED\n')
            self.assertFalse((root / 'failure' / 'mappings.json').exists())


if __name__ == '__main__':
    unittest.main()
