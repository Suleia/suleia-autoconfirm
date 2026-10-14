"""Prepare private deployment files on the VPS; never print credentials."""
import json, os, secrets, sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, quote

backup, release, image, revision = sys.argv[1:]
backup, release = Path(backup), Path(release)
assert str(backup).startswith('/opt/suleia-backups/order-intelligence-')
assert str(release).startswith('/opt/suleia-releases/')
os.umask(0o077)
def read(name): return json.loads((backup/name).read_text())
def save(name, value): (backup/name).write_text(json.dumps(value))
def env(container): return dict(v.split('=',1) for v in container['Config']['Env'])
def service(container):
    return {'image':container['Config']['Image'],'environment':env(container),
            'command':container['Config']['Cmd'],'entrypoint':container['Config']['Entrypoint'],
            'volumes':[{'type':'bind','source':m['Source'],'target':m['Destination'],'read_only':not m['RW']} for m in container['Mounts']]}
compose=read('compose-before.json')
old={s:read(s+'-before.json')[0] for s in ['api','mcp-server','review-panel']}
rollback={'services':{s:service(c) for s,c in old.items()}}
override={'services':{s:service(c) for s,c in old.items()}}
for s in ['api','mcp-server']:
    # Null inherited compose values absent from the actual container. Preserve
    # every runtime safety flag and private mount, not only .env defaults.
    actual=env(old[s]); base={k:None for k in compose['services'][s].get('environment',{})}
    override['services'][s]['environment']={**base,**actual,'SULEIA_BUILD_REVISION':revision,'SULEIA_BUILD_BRANCH':'feat/order-intelligence'}
    override['services'][s]['image']=image
override['services']['review-panel']['volumes']=[{'type':'bind','source':str(release/'apps/review-panel'),'target':'/usr/share/nginx/html','read_only':True}]
api_env=env(old['api'])
password=secrets.token_urlsafe(48)
db=urlsplit(api_env['OPERATIONS_DATABASE_URL'])
writer_url=urlunsplit((db.scheme,'suleia_analytics_materializer:'+quote(password,safe='')+'@'+db.netloc.split('@',1)[1],db.path,db.query,''))
previous_job=read('analytics-before.json') if (backup/'analytics-before.json').exists() else []
if previous_job:
    writer_url=env(previous_job[0])['ANALYTICS_DATABASE_URL']
    password=urlsplit(writer_url).password
    assert urlsplit(writer_url).username=='suleia_analytics_materializer'
    assert password and all(c.isalnum() or c in '-_' for c in password)
job_env={k:api_env[k] for k in ['OPERATIONS_DATABASE_URL','OPERATIONS_PRIVATE_DATA_KEY','FINANCE_REPORT_BASE_URL','FINANCE_REPORT_PASSWORD']}
job_env.update(ANALYTICS_DATABASE_URL=writer_url,ANALYTICS_INTERVAL_MS='300000',NODE_OPTIONS='--max-old-space-size=160',NODE_ENV='production')
assert all('\n' not in v for v in job_env.values())
(backup/'analytics.env').write_text(''.join(k+'='+v+'\n' for k,v in job_env.items()))
(backup/'role-password.sql').write_text("ALTER ROLE suleia_analytics_materializer PASSWORD '"+password+"';\n")
override['services']['analytics-materializer']={'image':image,'command':['node','packages/suleia-operations-mcp/src/analytics/materialize.mjs'],
    'env_file':[str(backup/'analytics.env')],'read_only':True,'restart':'unless-stopped','cap_drop':['ALL'],
    'security_opt':['no-new-privileges:true'],'mem_limit':'256m','cpus':0.5,
    'networks':['public_network','database_network'],
    'healthcheck':{'test':['CMD','node','packages/suleia-operations-mcp/src/analytics/health.mjs'],'interval':'60s','timeout':'10s','retries':3,'start_period':'120s'}}
if previous_job and previous_job[0]['State']['Running']:
    rollback['services']['analytics-materializer']={**override['services']['analytics-materializer'],**service(previous_job[0]),'env_file':[]}
    (backup/'restore-analytics').write_text('true')
save('runtime-override.json',override);save('rollback.json',rollback)
print('PRIVATE_DEPLOYMENT_CONFIGURATION_READY')
