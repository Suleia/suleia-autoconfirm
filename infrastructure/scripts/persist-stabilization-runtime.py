"""Persist bounded, non-PII runtime observations; never authorizes actions."""
import sys,json,pathlib,datetime,subprocess
snapshot=json.loads(pathlib.Path(sys.argv[1]).read_text())
health={x['service']:x for x in snapshot.get('functional_health',{}).get('components',[])}
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
rows=[]
modes={'api':'READ_ONLY','mcp-server':'READ_ONLY','ingestion-worker':'SHADOW_READ_ONLY','analytics-materializer':'READ_ONLY_ANALYTICS'}
for c in snapshot.get('containers',[]):
 service=c.get('service') or c.get('name');h=health.get(service,{});e=h.get('evidence',{})
 rows.append(dict(runtime_id=service,name=c.get('name') or service,platform='VPS',owner=service,
   capabilities=[],mode=e.get('mode') or modes.get(service,'UNVERIFIED'),
   commit=c.get('container_revision') or c.get('image_revision'),image=c.get('image'),digest=c.get('image_id'),
   health=c.get('health') or 'UNKNOWN',last_cycle=h.get('last_completed_cycle_at'),
   enabled=c.get('status')=='running',environment='VPS',observed_at=snapshot['generated_at'],evidence_reference='private-runtime/platform-runtime.json'))
for service in ['incidents-scheduler']:
 h=health.get(service,{});e=h.get('evidence',{})
 rows.append(dict(runtime_id=service,name='suleia-incidents.timer',platform='VPS',owner='systemd',capabilities=['SCHEDULE_INCIDENT_REVIEW'],
   mode='SCHEDULE_ONLY',health=h.get('health_status','UNKNOWN'),last_cycle=h.get('last_completed_cycle_at'),
   enabled=e.get('timer_active'),environment='VPS',observed_at=h.get('checked_at') or now,evidence_reference='systemd:suleia-incidents.timer'))
data=json.dumps(rows).replace("'","''")
query="""BEGIN;
INSERT INTO platform.runtime_registry(runtime_id,name,platform,owner,capabilities,mode,commit,image,digest,health,last_cycle,enabled,environment,observed_at,evidence_reference)
SELECT runtime_id,name,platform,owner,capabilities,mode,commit,image,digest,health,last_cycle,enabled,environment,observed_at,evidence_reference
FROM jsonb_to_recordset('"""+data+"""'::jsonb) AS r(runtime_id text,name text,platform text,owner text,capabilities jsonb,mode text,commit text,image text,digest text,health text,last_cycle timestamptz,enabled boolean,environment text,observed_at timestamptz,evidence_reference text)
ON CONFLICT(runtime_id) DO UPDATE SET name=EXCLUDED.name,commit=EXCLUDED.commit,image=EXCLUDED.image,digest=EXCLUDED.digest,
health=EXCLUDED.health,last_cycle=EXCLUDED.last_cycle,enabled=EXCLUDED.enabled,observed_at=EXCLUDED.observed_at,mode=EXCLUDED.mode;
INSERT INTO platform.database_size_samples(database_size,relation_sizes)
SELECT pg_database_size(current_database()),(SELECT jsonb_object_agg(schemaname||'.'||relname,pg_total_relation_size(relid)) FROM pg_stat_user_tables)
WHERE NOT EXISTS(SELECT 1 FROM platform.database_size_samples WHERE measured_at>now()-interval '1 hour');
COMMIT;"""
p=subprocess.run(['docker','exec','-i','suleia-operations-staging-postgres-1','psql','-U','suleia_admin','-d','suleia_staging','-Xq','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=45)
if p.returncode:raise SystemExit('RUNTIME_REGISTRY_PERSIST_FAILED')
print('RUNTIME_REGISTRY|PASS|rows='+str(len(rows)))
