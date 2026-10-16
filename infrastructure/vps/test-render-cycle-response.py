import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

root = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('validator', root / 'validate-render-cycle-response.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ResponseTests(unittest.TestCase):
    def payload(self):
        return {'ok': True, 'result': {'cycle': {'lastAutomationCycleAt': '2026-10-16T10:00:00Z'}}}

    def test_nested_success_cannot_hide_root_failure(self):
        self.assertEqual(validator.assess({'ok': False, 'result': {'ok': True}})[0], 'FAIL')
        self.assertEqual(validator.assess({'ok': 'true'})[0], 'FAIL')

    def test_each_stage_error_is_visible_without_leaking_its_message(self):
        for stage in ('ingestError', 'shopifyIngestError', 'templateBackfillError', 'preparedTemplateBackfillError', 'confirmError'):
            value = self.payload()
            value['result']['cycle'][stage] = 'sensitive provider message'
            status, reason = validator.assess(value)
            self.assertEqual(status, 'FAIL')
            self.assertIn(stage, reason)
            self.assertNotIn('sensitive', reason)
        value = self.payload()
        value['result']['operationalOrders'] = {'ok': False, 'error': 'private'}
        self.assertEqual(validator.assess(value)[0], 'FAIL')

    def test_completion_and_overlap_are_distinct(self):
        self.assertEqual(validator.assess(self.payload())[0], 'PASS')
        self.assertEqual(validator.assess({'ok': True, 'result': {'cycle': {}}})[0], 'FAIL')
        self.assertEqual(validator.assess({'ok': True, 'result': {'cycle': {'skipped': True}}})[0], 'SKIP')

    def run_runner(self, payload=None, curl_exit=0):
        with tempfile.TemporaryDirectory() as directory:
            temp = pathlib.Path(directory)
            curl = temp / 'curl'
            curl.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f: f.write(json.dumps(args)+'\\n')
pathlib.Path(args[args.index('--output')+1]).write_text(os.environ['PAYLOAD'])
print('200',end='')
sys.exit(int(os.environ['CURL_EXIT']))
''')
            curl.chmod(0o755)
            envfile = temp / 'env'
            envfile.write_text('CRON_SECRET=test-only-secret\nRENDER_AUTOMATION_URL=https://suleia-autoconfirm.onrender.com/api/cron/automation-cycle\n')
            env = {**os.environ, 'PATH': str(temp)+os.pathsep+os.environ['PATH'], 'CALLS': str(temp/'calls'), 'PAYLOAD': json.dumps(payload), 'CURL_EXIT': str(curl_exit), 'SULEIA_RENDER_AUTOMATION_ENV': str(envfile), 'SULEIA_RENDER_AUTOMATION_LOCK': str(temp/'lock'), 'SULEIA_RENDER_CYCLE_VALIDATOR': str(root/'validate-render-cycle-response.py')}
            result = subprocess.run(['bash', str(root/'run-render-automation-cycle.sh')], env=env, capture_output=True, text=True)
            calls = [json.loads(line) for line in (temp/'calls').read_text().splitlines()]
            self.assertNotIn('test-only-secret', result.stdout+result.stderr)
            return result, calls

    def test_uncertain_transport_fails_without_retry(self):
        result, calls = self.run_runner(self.payload(), 28)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)
        self.assertFalse(any(arg.startswith('--retry') for arg in calls[0]))
        self.assertIn('transport_uncertain', result.stdout)

    def test_runner_reports_partial_failure_and_real_success(self):
        result, _ = self.run_runner({'ok': False, 'result': {'ok': True}})
        self.assertNotEqual(result.returncode, 0)
        result, _ = self.run_runner(self.payload())
        self.assertEqual(result.returncode, 0)
        self.assertIn('|PASS|', result.stdout)


if __name__ == '__main__':
    unittest.main()
