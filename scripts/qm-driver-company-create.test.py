"""Synthetic tests only: no PostgreSQL, live SSH, or real company evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
import os
import stat
import tempfile
import subprocess
import sys
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('qm-driver-company-create.py')

def load():
    spec = importlib.util.spec_from_file_location('company_create', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def fixture():
    return {'version': 1, 'intent': 'CREATE_MISSING_QM_COMPANIES',
            'scope': {'provider': 'QUICKMANAGE', 'accountKey': 'synthetic-account', 'operatingGroupId': 'synthetic-group'},
            'evidenceSha256': 'a' * 64, 'mappingSha256': 'b' * 64,
            'existingMappings': [{'provider': 'QUICKMANAGE', 'accountKey': 'synthetic-account',
                'operatingGroupId': 'synthetic-group', 'providerCompanyId': 'old-source',
                'companyId': 'old-company', 'evidenceReference': 'old-archive'}],
            'companies': [{'providerCompanyId': 'new-source-1', 'companyId': '11111111-1111-4111-8111-111111111111',
                'companyName': "Synthetic O'Example; --", 'membershipId': '21111111-1111-4111-8111-111111111111'},
                {'providerCompanyId': 'new-source-2', 'companyId': '31111111-1111-4111-8111-111111111111',
                'companyName': ' Synthetic Exact Spaces ', 'membershipId': '41111111-1111-4111-8111-111111111111'}]}

class PlanTests(unittest.TestCase):
    def test_standalone_validator_preserves_names_rejects_ambiguity(self):
        self.assertTrue(SCRIPT.exists(), 'standalone creator is missing')
        m = load()
        p = fixture()
        self.assertEqual(m.validate_plan(json.dumps(p).encode()), p)
        variants = []
        for key, value in [('version', True), ('unknown', 1), ('companies', []), ('mappingSha256', 'bad')]:
            q = copy.deepcopy(p); q[key] = value; variants.append(q)
        for key, value in [('companyId', '{11111111-1111-4111-8111-111111111111}'),
                           ('companyName', '   '), ('companyName', 'unsafe\nname'),
                           ('providerCompanyId', 'old-source'), ('membershipId', p['companies'][0]['companyId'])]:
            q = copy.deepcopy(p); q['companies'][0][key] = value; variants.append(q)
        q = copy.deepcopy(p); q['companies'].append(q['companies'][0]); variants.append(q)
        q = copy.deepcopy(p); q['existingMappings'][0]['accountKey'] = 'wrong'; variants.append(q)
        for q in variants:
            with self.subTest(q=q), self.assertRaises(m.CreateError):
                m.validate_plan(json.dumps(q).encode())
        with self.assertRaises(m.CreateError):
            m.validate_plan(b'{"version":1,"version":1}')

class SQLProtocolTests(unittest.TestCase):
    def test_sql_is_parameterized_atomic_and_verifies_after_commit(self):
        m = load()
        self.assertTrue(hasattr(m, 'build_sql'), 'SQL executable is missing')
        p = fixture()
        sql = m.build_sql(p, apply=True)
        self.assertNotIn(p['companies'][0]['companyName'], sql)
        self.assertIn('BEGIN ISOLATION LEVEL SERIALIZABLE', sql)
        self.assertIn('FOR UPDATE', sql)
        self.assertIn('lock_timeout', sql)
        self.assertIn('statement_timeout', sql)
        self.assertIn('COMMIT;\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', sql)
        for table in ('Company', 'CompanyMembership', 'OperatingGroupCompany'):
            self.assertIn('INSERT INTO "' + table + '"', sql)
        for table in ('ArchiveCompany', 'FinancialSource', 'FinancialTransaction', 'ArchiveScopeGrant'):
            self.assertNotIn('INSERT INTO "' + table + '"', sql)
        for forbidden in ('DELETE FROM', 'UPDATE "', 'CREATE TABLE', 'CREATE FUNCTION', 'ON CONFLICT'):
            self.assertNotIn(forbidden, sql)
        for guard in ('MAPPING_CHANGED', 'OWNER_AMBIGUOUS', 'ARCHIVE_IDENTITY_CONFLICT',
                      'SAME_NAME_REVIEW', 'REPLAY_MISMATCH', 'MEMBERSHIP_ID_CONFLICT'):
            self.assertIn(guard, sql)
        preview = m.build_sql(p, apply=False)
        self.assertIn('READ ONLY', preview)
        self.assertNotIn('INSERT INTO', preview)
        self.assertNotIn('FOR UPDATE', preview)
        self.assertNotIn('COMMIT;', preview)
        self.assertNotIn('Financial', preview)

class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.m = load()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.plan = self.root / 'plan.json'
        self.plan.write_text(json.dumps(fixture())); self.plan.chmod(0o600)

    def test_receipt_rejects_wrong_ids_counts_and_extra_pii(self):
        p = fixture()
        receipt = {'version': 1, 'kind': 'COMPANY_CREATION_RECEIPT', 'applied': True,
                   'verified': True, 'created': 2, 'existing': 0, 'ownerUserId': 'synthetic-owner',
                   'companies': [{k: row[k] for k in ('providerCompanyId', 'companyId', 'membershipId')}
                                 for row in p['companies']]}
        self.assertEqual(self.m.validate_receipt(json.dumps(receipt).encode(), p, True)['created'], 2)
        variants = []
        for k, v in [('created', True), ('existing', 1), ('applied', False), ('companyName', 'synthetic'), ('verified', False)]:
            q = copy.deepcopy(receipt); q[k] = v; variants.append(q)
        q = copy.deepcopy(receipt); q['companies'][0]['companyId'] = 'wrong'; variants.append(q)
        q = copy.deepcopy(receipt); q['companies'][0]['companyName'] = 'synthetic'; variants.append(q)
        for q in variants:
            with self.subTest(q=q), self.assertRaises(self.m.CreateError):
                self.m.validate_receipt(json.dumps(q).encode(), p, True)

    def test_private_input_and_output_safety(self):
        self.assertTrue(hasattr(self.m, 'read_plan'), 'safe plan reader missing')
        self.assertEqual(self.m.read_plan(self.plan)[1], fixture())
        for kind in ('symlink', 'fifo', 'hardlink'):
            path = self.root / kind
            if kind == 'symlink': path.symlink_to(self.plan)
            elif kind == 'fifo': os.mkfifo(path)
            else: os.link(self.plan, path)
            with self.subTest(kind=kind), self.assertRaises(self.m.CreateError): self.m.read_plan(path)
            path.unlink()
        self.plan.chmod(0o644)
        with self.assertRaises(self.m.CreateError): self.m.read_plan(self.plan)
        git = self.root / 'repo'; git.mkdir(); (git / '.git').write_text('synthetic')
        with self.assertRaises(self.m.CreateError): self.m.new_output_dir(git / 'out')
        out = self.m.new_output_dir(self.root / 'out')
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        self.m.exclusive_write(out / 'receipt', b'synthetic')
        self.assertEqual(stat.S_IMODE((out / 'receipt').stat().st_mode), 0o600)
        with self.assertRaises(OSError): self.m.exclusive_write(out / 'receipt', b'overwrite')

    def synthetic_shell(self, apply=False, hostname='ubuntu-8gb-hel1-2', containers='abc123', failure=False):
        # Executes the actual emitted remote shell through local synthetic SSH
        # and Docker executables. Docker does NOT execute psql or any database.
        bindir = self.root / 'bin'; bindir.mkdir(exist_ok=True)
        reply = {'version': 1, 'kind': 'COMPANY_CREATION_RECEIPT', 'applied': apply,
                 'verified': True, 'created': 2, 'existing': 0, 'ownerUserId': 'synthetic-owner',
                 'companies': [{k: row[k] for k in ('providerCompanyId', 'companyId', 'membershipId')}
                               for row in fixture()['companies']]}
        (self.root / 'reply').write_text(json.dumps(reply))
        programs = {
          'ssh': 'import subprocess,sys\nfrom pathlib import Path\nPath(sys.argv[0]).with_name("ssh-args").write_text("\\n".join(sys.argv[1:]))\nr=subprocess.run(["sh","-s"],input=sys.stdin.buffer.read());sys.exit(r.returncode)\n',
          'hostname': 'print(' + repr(hostname) + ')\n',
          'docker': ('import sys\nfrom pathlib import Path\np=Path(sys.argv[0]).parent.parent\n'
             'if sys.argv[1]=="ps": print(' + repr(containers) + ')\n'
             'else:\n (p/"sql").write_bytes(sys.stdin.buffer.read())\n'
             ' (p/"docker-args").write_text("\\n".join(sys.argv[1:]))\n'
             ' (p/"calls").open("a").write("called\\n")\n' +
             (' print("SYNTHETIC SECRET NAME",file=sys.stderr);sys.exit(9)\n' if failure else
              ' print((p/"reply").read_text())\n'))}
        for name, code in programs.items():
            f = bindir / name; f.write_text('#!' + sys.executable + '\n' + code); f.chmod(0o700)
        env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'])
        args = [sys.executable, str(SCRIPT), '--plan', str(self.plan), '--output-dir', str(self.root / 'result')]
        if apply: args.append('--apply')
        return subprocess.run(args, env=env, capture_output=True, text=True, timeout=10)

    def test_readonly_shell_protocol_and_private_hash_receipt(self):
        result = self.synthetic_shell()
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary['wouldCreate'], 2)
        self.assertEqual(summary['created'], 0)
        self.assertFalse(summary['applied'])
        sql = (self.root / 'sql').read_text()
        self.assertNotIn('INSERT INTO', sql)
        self.assertIn('END;\n$qm_company_create$;', sql)
        receipt = json.loads((self.root / 'result' / 'receipt.json').read_text())
        import hashlib
        self.assertEqual(receipt['planSha256'], hashlib.sha256(self.plan.read_bytes()).hexdigest())
        self.assertEqual(receipt['kind'], 'COMPANY_CREATION_RECEIPT')
        self.assertNotIn('companyName', json.dumps(receipt))
        self.assertNotIn('synthetic-owner', result.stdout)
        self.assertNotIn(fixture()['companies'][0]['companyName'], result.stdout + result.stderr)
        self.assertFalse((self.root / 'result' / 'known_hosts').exists())
        args = (self.root / 'bin' / 'ssh-args').read_text()
        self.assertIn('StrictHostKeyChecking=yes', args)
        self.assertIn('ControlPath=none', args)
        self.assertIn('fleetpilot@65.21.187.209', args)
        self.assertIn('default_transaction_read_only=on', (self.root / 'docker-args').read_text())

    def test_apply_shell_protocol_and_no_blind_retry(self):
        result = self.synthetic_shell(apply=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['created'], 2)
        self.assertIn('COMMIT;\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', (self.root / 'sql').read_text())
        self.assertEqual((self.root / 'calls').read_text(), 'called\n')

    def test_uncertain_failure_never_leaks_or_retries(self):
        result = self.synthetic_shell(apply=True, failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('APPLY_OUTCOME_UNCERTAIN', result.stderr)
        self.assertNotIn('SYNTHETIC SECRET NAME', result.stderr + result.stdout)
        self.assertEqual((self.root / 'calls').read_text(), 'called\n')
        self.assertFalse((self.root / 'result' / 'receipt.json').exists())

    def test_hostname_guard_fails_before_database(self):
        result = self.synthetic_shell(hostname='wrong-host')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'sql').exists())

    def test_multiple_containers_fail_before_database(self):
        result = self.synthetic_shell(containers='abc123\ndef456')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'sql').exists())

    def test_apply_stdout_report_failure_is_explicitly_uncertain(self):
        with patch.object(self.m, 'run', return_value={'applied': True}), patch('builtins.print', side_effect=[OSError('synthetic'), None]) as printer:
            self.assertEqual(self.m.main(['--plan', 'synthetic', '--output-dir', 'synthetic', '--apply']), 1)
            self.assertIn('APPLY_OUTCOME_UNCERTAIN', printer.call_args_list[-1].args[0])

    def test_apply_cleanup_failure_is_explicitly_uncertain(self):
        p = fixture()
        response = {'version': 1, 'kind': 'COMPANY_CREATION_RECEIPT', 'applied': True,
                    'verified': True, 'created': 2, 'existing': 0, 'ownerUserId': 'synthetic-owner',
                    'companies': [{k: row[k] for k in ('providerCompanyId', 'companyId', 'membershipId')}
                                  for row in p['companies']]}
        original = Path.unlink
        def fail_pin(path, *args, **kwargs):
            if path.name == 'known_hosts': raise OSError('synthetic private error')
            return original(path, *args, **kwargs)
        with patch.object(self.m, 'bounded_run', return_value=json.dumps(response).encode()), patch.object(Path, 'unlink', fail_pin):
            with self.assertRaisesRegex(self.m.CreateError, 'APPLY_OUTCOME_UNCERTAIN'):
                self.m.run(self.plan, self.root / 'result', True)

    def test_bounded_transport_discards_stderr_and_kills_flood(self):
        self.assertTrue(hasattr(self.m, 'bounded_run'), 'bounded transport missing')
        with self.assertRaises(self.m.CreateError):
            self.m.bounded_run([sys.executable, '-c', 'import sys;sys.stderr.write("x"*10000)'], b'', limit=100)
        with self.assertRaises(self.m.CreateError):
            self.m.bounded_run([sys.executable, '-c', 'import time;time.sleep(10)'], b'', seconds=.1)

if __name__ == '__main__':
    unittest.main()
