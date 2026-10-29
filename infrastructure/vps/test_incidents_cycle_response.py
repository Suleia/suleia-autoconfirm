import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('validator', pathlib.Path(__file__).with_name('validate-incidents-cycle-response.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
NOW = '2026-08-01T10:00:00Z'


class Receipts(unittest.TestCase):
    def test_verified_completion_retains_only_safe_fields(self):
        payload = {'ok': True, 'result': {'updatedAt': NOW, 'count': 1,
                   'incidents': [{'incidentType': 'absent', 'phone': 'PRIVATE_FIXTURE'}],
                   'discountRecoverySummary': {'sent': 1},
                   'customerActivitySummary': {'verified': 1, 'message': 'PRIVATE_FIXTURE'}}}
        result = validator.receipt(json.dumps(payload), '200', 0, NOW, NOW)
        self.assertTrue(result['ok'])
        self.assertEqual(result['offersSent'], 1)
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(result))

    def test_transport_and_http_failures_never_authorize_retry_or_expose_response(self):
        for status, code, error in [('000', 28, 'TRANSPORT_FAILED'), ('504', 0, 'HTTP_RESPONSE_FAILED')]:
            result = validator.receipt('PRIVATE_FIXTURE', status, code, NOW, NOW)
            self.assertEqual(result['error'], error)
            self.assertEqual(result['actionOutcome'], 'UNKNOWN')
            self.assertFalse(result['retryAutomatically'])
            self.assertNotIn('PRIVATE_FIXTURE', json.dumps(result))

    def test_invalid_or_partial_completion_fails_closed(self):
        for body in ['broken', 'null', '[]', '{"ok":false}', '{"ok":true,"result":{}}']:
            self.assertFalse(validator.receipt(body, '200', 0, NOW, NOW)['ok'])

    def test_failure_preserves_last_success_and_durable_failure_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            success = {'ok': True, 'count': 2}
            failure = {'ok': False, 'actionOutcome': 'UNKNOWN', 'retryAutomatically': False}
            validator.write_receipt(directory, success)
            validator.write_receipt(directory, failure)
            path = pathlib.Path(directory)
            self.assertEqual(json.loads((path/'last-cycle.json').read_text()), success)
            self.assertEqual(json.loads((path/'last-run.json').read_text()), failure)
            self.assertEqual(json.loads((path/'last-failure.json').read_text()), failure)
            validator.write_receipt(directory, success)
            self.assertEqual(json.loads((path/'last-failure.json').read_text()), failure)


if __name__ == '__main__':
    unittest.main()
