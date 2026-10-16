import json
import pathlib
import sys


def assess(payload):
    if not isinstance(payload, dict) or payload.get('ok') is not True:
        return 'FAIL', 'invalid_response'
    result = payload.get('result')
    if not isinstance(result, dict) or not isinstance(result.get('cycle'), dict):
        return 'FAIL', 'missing_cycle'
    cycle = result['cycle']
    errors = [key for key in (
        'ingestError', 'shopifyIngestError', 'templateBackfillError',
        'preparedTemplateBackfillError', 'confirmError'
    ) if cycle.get(key)]
    for stage in ('unanswered', 'operationalOrders'):
        value = result.get(stage)
        if isinstance(value, dict) and (value.get('ok') is False or value.get('error')):
            errors.append(stage)
    if errors:
        return 'FAIL', 'stage_errors:' + ','.join(errors)
    if cycle.get('skipped'):
        return 'SKIP', 'cycle_not_executed'
    if not cycle.get('lastAutomationCycleAt'):
        return 'FAIL', 'missing_completion'
    return 'PASS', 'completed'


if __name__ == '__main__':
    try:
        status, reason = assess(json.loads(pathlib.Path(sys.argv[1]).read_text()))
    except (OSError, ValueError, IndexError):
        status, reason = 'FAIL', 'invalid_json'
    print(f'SULEIA_RENDER_AUTOMATION|{status}|reason={reason}|rules=existing|secret_disclosed=0')
    sys.exit(1 if status == 'FAIL' else 0)
