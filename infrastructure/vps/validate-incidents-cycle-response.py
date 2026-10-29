#!/usr/bin/env python3
"""Record sanitized cron transport receipts without replaying uncertain writes."""
import datetime
import json
import os
import pathlib
import sys


def timestamp(value):
    try:
        parsed = datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.isoformat() if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def count(value):
    return value if type(value) is int and value >= 0 else None


def receipt(body, http_status, curl_exit, started_at, completed_at):
    status = str(http_status) if str(http_status).isdigit() and len(str(http_status)) == 3 else '000'
    result = {'startedAt': timestamp(started_at), 'completedAt': timestamp(completed_at),
              'httpStatus': status, 'curlExit': curl_exit, 'ok': False,
              'actionOutcome': 'UNKNOWN', 'retryAutomatically': False}
    if curl_exit:
        result['error'] = 'TRANSPORT_FAILED'
        return result
    if status != '200':
        result['error'] = 'HTTP_RESPONSE_FAILED'
        return result
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        result['error'] = 'INVALID_JSON_RESPONSE'
        return result
    data = payload.get('result') if isinstance(payload, dict) else None
    if not isinstance(data, dict) or payload.get('ok') is not True or not timestamp(data.get('updatedAt')):
        result['error'] = 'COMPLETION_NOT_VERIFIED'
        return result
    if not isinstance(data.get('incidents'), list) or count(data.get('count')) is None:
        result['error'] = 'COMPLETION_NOT_VERIFIED'
        return result
    def nested(key, field):
        value = data.get(key)
        return count(value.get(field)) if isinstance(value, dict) else None
    activity = data.get('customerActivitySummary')
    activity = {key: count(activity.get(key)) for key in
                ('checked', 'detected', 'verified', 'afterRejectedTemplate', 'actionable', 'viaButton')} if isinstance(activity, dict) else None
    kinds = {}
    for incident in data['incidents']:
        kind = incident.get('incidentType') if isinstance(incident, dict) else None
        kind = kind if kind in ('absent', 'rejected_goods', 'address', 'agency', 'missing_data', 'other') else 'unknown'
        kinds[kind] = kinds.get(kind, 0) + 1
    result.update(ok=True, actionOutcome='REVIEW_COMPLETED', reviewStartedAt=timestamp(data['updatedAt']),
                  count=data['count'], types=kinds, activity=activity,
                  offersSent=nested('discountRecoverySummary', 'sent'),
                  returnsVerified=nested('discountReturnSummary', 'requestedVerified'),
                  resolutionFailures=nested('incidentResolutionSummary', 'failures'))
    checked = activity.get('checked') if activity else None
    verified = activity.get('verified') if activity else None
    coverage = 'UNKNOWN'
    if checked is not None and verified is not None:
        coverage = 'VERIFIED' if checked == verified else ('BLOCKED' if verified == 0 else 'PARTIAL')
    result['customerReadCoverage'] = coverage
    result['blockedChatbyReads'] = nested('discountRecoverySummary', 'blockedChatbyRead')
    if coverage in ('BLOCKED', 'PARTIAL'):
        result['actionOutcome'] = 'REVIEW_COMPLETED_WITH_READ_BLOCKS'
    return result


def write_receipt(directory, result):
    directory = pathlib.Path(directory)
    def save(name):
        temporary = directory / (name + '.tmp')
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(result, output)
        temporary.replace(directory / name)
    save('last-run.json')
    # A failed HTTP call does not erase the last independently acknowledged
    # completion, nor authorize another POST. The backend may still be running.
    save('last-cycle.json' if result['ok'] else 'last-failure.json')


if __name__ == '__main__':
    response_file, http_status, curl_exit, started_at = sys.argv[1:5]
    body = pathlib.Path(response_file).read_text(errors='replace')
    result = receipt(body, http_status, int(curl_exit), started_at,
                     datetime.datetime.now(datetime.timezone.utc).isoformat())
    write_receipt('/var/lib/suleia-incidents', result)
    print(json.dumps(result))
    sys.exit(0 if result['ok'] else 1)
