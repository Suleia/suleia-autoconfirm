"""Read-only host observations; never export provider env, sessions or evidence."""
import json, pathlib, subprocess, datetime, sys, os

def read(path):
    try: return json.loads(pathlib.Path(path).read_text())
    except (OSError, ValueError): return {}

def age(value, now):
    try: return (now-datetime.datetime.fromisoformat(value.replace('Z','+00:00'))).total_seconds()
    except (ValueError, TypeError, AttributeError): return None

def browser_health(health, progress, now):
    completed=progress.get('completedAt')
    lag=age(completed,now)
    heartbeat=age(health.get('at'),now)
    healthy=(health.get('captureSelfTest') is True and health.get('readiness')=='READY'
             and heartbeat is not None and 0<=heartbeat<=300 and lag is not None and 0<=lag<=2100)
    return {'service':'incident-browser','checked_at':now.isoformat(),
      'health_status':'HEALTHY' if healthy else 'UNHEALTHY',
      'reason':'VERIFIED_BROWSER_AND_CYCLE' if healthy else 'BROWSER_OR_CYCLE_NOT_CURRENT',
      'last_completed_cycle_at':completed,
      'evidence':{'mode':health.get('mode'),'capture_self_test':health.get('captureSelfTest') is True,
        'execution_enabled':health.get('executionEnabled') is True,'cycle_lag_seconds':lag,
        'last_cycle_started':progress.get('startedAt'),'last_cycle_completed':completed,
        'next_tick':health.get('schedule',{}).get('nextRunAt')}}

def scheduler_health(cycle, active, now):
    lag=age(cycle.get('completedAt'),now)
    healthy=active=='active' and cycle.get('ok') is True and lag is not None and 0<=lag<=2100
    return {'service':'incidents-scheduler','checked_at':now.isoformat(),
      'health_status':'HEALTHY' if healthy else 'UNHEALTHY',
      'reason':'PERSISTENT_TIMER_AND_VERIFIED_CYCLE' if healthy else 'TIMER_OR_CYCLE_NOT_CURRENT',
      'last_completed_cycle_at':cycle.get('completedAt'),
      'evidence':{'timer_active':active=='active','last_tick':cycle.get('reviewStartedAt'),
        'last_cycle_completed':cycle.get('completedAt'),'lag_seconds':lag,'last_cycle_success':cycle.get('ok'),
        'resolution_failures':cycle.get('resolutionFailures'),'interval_minutes':30}}

if __name__=='__main__':
    now=datetime.datetime.now(datetime.timezone.utc)
    active=subprocess.run(['systemctl','is-active','suleia-incidents.timer'],capture_output=True,text=True).stdout.strip()
    components=[browser_health(read('/opt/suleia-incident-browser/state/health.json'),read('/opt/suleia-incident-browser/state/cycle-progress.json'),now),
      scheduler_health(read('/var/lib/suleia-incidents/last-cycle.json'),active,now)]
    output=pathlib.Path(sys.argv[1]);os.umask(0o077)
    tmp=output.with_suffix('.tmp');tmp.write_text(json.dumps({'components':components}));tmp.replace(output)
