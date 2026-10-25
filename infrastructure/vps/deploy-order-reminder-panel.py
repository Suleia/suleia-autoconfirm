"""Narrow API/static overlay; no bot, SQL, policy, timer or ledger mutations.

Root-only state captures the actual predecessor. Rollback changes application
and static code only; never restores financial/customer state or old flags.
"""
import os,pathlib,subprocess,json,hashlib,fcntl,datetime,time,sys,tarfile,shutil
from zoneinfo import ZoneInfo
assert os.geteuid()==0
os.umask(0o077)
M=json.loads(pathlib.Path(sys.argv[2]).read_text());short=M['revision'][:7]
D=pathlib.Path('/root/suleia-order-reminder-panel-deploy')/short
D.mkdir(parents=True,exist_ok=True,mode=0o700)
API='suleia-operations-staging-api-1';PANEL='suleia-operations-staging-review-panel-1';DB='suleia-operations-staging-postgres-1'
R=pathlib.Path('/etc/suleia/order-reminder-panel-'+short+'-runtime.json')
def run(args,body=None):
 p=subprocess.run(args,input=body,capture_output=True)
 if p.returncode:(D/'error.private.log').write_bytes(p.stdout+b'\n'+p.stderr);raise RuntimeError('COMMAND_FAILED_PRIVATE_DIAGNOSTIC')
 return p.stdout
def inspect(n):return json.loads(run(['docker','inspect',n]))[0]
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def env(i):return dict(x.split('=',1)for x in i['Config']['Env'])
def sql(q):return run(['docker','exec','-i',DB,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','suleia_admin','-d','suleia_staging'],('BEGIN READ ONLY;'+q+';COMMIT;').encode()).decode()
def one(q):return next(x for x in sql('SELECT '+q).splitlines()if x not in ['BEGIN','COMMIT',''])
def ids():return {r['Names']:r['ID']for r in [json.loads(x)for x in run(['docker','ps','--no-trunc','--format','{{json .}}']).decode().splitlines()]}
def filehashes():
 paths=['/etc/suleia/telegram.env','/etc/systemd/system/suleia-telegram.service','/etc/suleia/shopify-dropea-recovery.env','/etc/systemd/system/suleia-shopify-dropea-recovery.service','/etc/systemd/system/suleia-shopify-dropea-recovery.timer','/etc/suleia/address-import-recovery-shadow.env','/etc/systemd/system/suleia-address-import-recovery-shadow.path','/etc/systemd/system/suleia-address-import-recovery-shadow.service']
 return {p:sha(pathlib.Path(p).read_bytes())for p in paths}
def botpid():return run(['systemctl','show','suleia-telegram.service','-p','MainPID','--value']).decode().strip()
def quiet():
 n=datetime.datetime.now(ZoneInfo('Europe/Madrid'));minute=n.hour*60+n.minute
 assert all(abs(minute-t)>6 for t in [480,600,720,960,1080,1350]),'BUDGET_WINDOW_RETRY_LATER'
 for table,states in [('ads_operations',"'UNKNOWN','EXECUTING'"),('ads_autopilot_slots',"'EXECUTING'"),('ads_executive_deliveries',"'SENDING'"),('ads_executive_reports',"'PREPARING'")]:assert one('count(*) FROM economics.'+table+' WHERE state IN ('+states+')')=='0','FINANCIAL_OPERATION_RECONCILE_FIRST'
def sourcehashes(container):
 code="import fs from 'node:fs';import crypto from 'node:crypto';const r={};function scan(p){if(!fs.existsSync(p))return;for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=p+'/'+d.name;if(d.isDirectory()){if(!['node_modules','.git','data','output'].includes(d.name))scan(f);}else if(d.isFile()&&/\\.(mjs|js|json|sql)$/.test(d.name))r[f.slice(5)]=crypto.createHash('sha256').update(fs.readFileSync(f).toString().replaceAll('\\r\\n','\\n')).digest('hex');}}for(const p of ['/app/apps/api','/app/services','/app/packages','/app/shared','/app/autoconfirm/src'])scan(p);console.log(JSON.stringify(r));"
 return json.loads(run(['docker','exec',container,'node','--input-type=module','-e',code]))
def compose(S,include=True):
 a=['docker','compose','-p','suleia-operations-staging','--env-file',S['envFile']]
 for p in S['composeFiles']+([str(R)]if include else []):a+=['-f',p]
 return a
def healthy():
 for _ in range(45):
  if inspect(API)['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(1)
 raise RuntimeError('API_NOT_HEALTHY')
def stable(S):
 assert filehashes()==S['criticalFiles'],'UNRELATED_AUTOMATION_OR_BOT_CONFIG_CHANGED'
 assert botpid()==S['botPid'] and int(S['botPid'])>0,'BOT_PROCESS_CHANGED'
 assert str(pathlib.Path('/opt/suleia-telegram').resolve())==S['botRelease'],'BOT_RELEASE_CHANGED'
 assert one("md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY rate_id)::text,'[]')) FROM economics.finance_cost_rates r")==S['financeHash'],'FINANCE_RATES_CHANGED'
 now=ids();assert all(now.get(k)==v for k,v in S['containers'].items()if k not in [API,PANEL]),'UNRELATED_CONTAINER_CHANGED'
 for p,h in S['composeHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h,'PRECEDING_COMPOSE_CHANGED'
def verify(S):
 healthy();stable(S);a=inspect(API)
 assert a['Image']==S['imageId'] and env(a)==S['newEnv'],'API_IMAGE_OR_ENV_DRIFT'
 actual=sourcehashes(API);changed={f['path']:f['after']for f in M['apiFiles']}
 assert actual=={**S['sourceHashes'],**changed},'UNRELATED_APPLICATION_SOURCE_CHANGED'
 p=next(m['Source']for m in inspect(PANEL)['Mounts']if m['Destination']=='/usr/share/nginx/html')
 assert p==S['panel'],'PANEL_MOUNT_CHANGED'
 after={str(x.relative_to(p)):sha(x.read_bytes())for x in pathlib.Path(p).rglob('*')if x.is_file()}
 expected={**S['staticHashes'],**{pathlib.Path(f['path']).name:f['after']for f in M['panelFiles']}}
 assert after==expected,'UNRELATED_PANEL_SOURCE_CHANGED'
 return {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'revision':M['revision'],'healthy':True,'imageId':S['imageId'],'apiSourceFilesVerified':len(actual),'staticFilesVerified':len(after),'applicationChanges':3,'botPidPreserved':True,'allOtherApiEnvironmentPreserved':True,'unrelatedContainersAutomationsFinancePreserved':True,'customerOrBudgetWrites':0,'panel':S['panel']}
phase=sys.argv[1]
lock=open('/run/lock/suleia-budget-v51-deploy.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if phase=='stage':
 assert not(D/'state.private.json').exists()and not R.exists(),'STAGE_EXISTS_RECONCILE'
 a=inspect(API);p=inspect(PANEL)
 assert a['Image']==M['baseImageId']and a['Config']['Image']==M['baseImage'],'ACTUAL_BASE_CHANGED'
 prior=next(pathlib.Path(m['Source'])for m in p['Mounts']if m['Destination']=='/usr/share/nginx/html')
 assert str(prior)==M['panelBase'],'ACTUAL_PANEL_BASE_CHANGED'
 files=a['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
 S={'beforeApi':a,'beforePanel':p,'composeFiles':files,'composeHashes':{f:sha(pathlib.Path(f).read_bytes())for f in files},'envFile':'/opt/suleia-releases/7d701365723507969b32ff0601b01f4fdc7dc615/.env','criticalFiles':filehashes(),'botPid':botpid(),'botRelease':str(pathlib.Path('/opt/suleia-telegram').resolve()),'containers':ids(),'financeHash':one("md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY rate_id)::text,'[]')) FROM economics.finance_cost_rates r"),'sourceHashes':sourcehashes(API),'staticHashes':{str(x.relative_to(prior)):sha(x.read_bytes())for x in prior.rglob('*')if x.is_file()},'panel':'/opt/suleia-panel-releases/order-reminder-'+short}
 archive=pathlib.Path(M['archive']);assert hashlib.sha256(archive.read_bytes()).hexdigest()==M['archiveSha256'],'ARCHIVE_MISMATCH'
 source=D/'source';source.mkdir(mode=0o700);allowed={f['path']for f in M['apiFiles']+M['panelFiles']}|{'Dockerfile'}
 with tarfile.open(archive)as t:
  for f in t.getmembers():assert f.isfile()and f.name in allowed and(source/f.name).resolve().is_relative_to(source),'UNSAFE_ARCHIVE'
  t.extractall(source,filter='data')
 for f in M['apiFiles']:
  assert S['sourceHashes'].get(f['path'])==f['before'],'API_BASE_FILE_CHANGED'
  assert sha((source/f['path']).read_bytes())==f['after'],'SOURCE_MISMATCH'
 for f in M['panelFiles']:
  assert S['staticHashes'].get(pathlib.Path(f['path']).name)==f['before'],'PANEL_BASE_FILE_CHANGED'
  assert sha((source/f['path']).read_bytes())==f['after'],'SOURCE_MISMATCH'
 run(['docker','build','--network','none','--pull=false','-t',M['image'],str(source)])
 S['imageId']=inspect(M['image'])['Id'];updates={'SULEIA_BUILD_REVISION':M['revision'],'SULEIA_BUILD_VERSION':'suleia-order-reminder-panel'};S['newEnv']={**env(a),**updates}
 shutil.copytree(prior,S['panel'])
 for f in M['panelFiles']:shutil.copyfile(source/f['path'],pathlib.Path(S['panel'])/pathlib.Path(f['path']).name)
 for x in [pathlib.Path(S['panel']),*pathlib.Path(S['panel']).rglob('*')]:x.chmod(0o755 if x.is_dir()else 0o644)
 S['override']={'services':{'api':{'image':M['image'],'environment':updates},'review-panel':{'volumes':[S['panel']+':/usr/share/nginx/html:ro']}}}
 (D/'state.private.json').write_text(json.dumps(S));(D/'manifest.json').write_text(json.dumps(M));shutil.copyfile(__file__,D/'deploy.py')
 print(json.dumps({'staged':True,'deployed':False,'imageId':S['imageId'],'baseImageVerified':True,'apiSourcesCaptured':len(S['sourceHashes']),'botPidCaptured':True}))
elif phase=='apply':
 S=json.loads((D/'state.private.json').read_text());assert not(D/'applied.json').exists(),'ALREADY_APPLIED_RECONCILE'
 T=json.loads(pathlib.Path(M['testReceipt']).read_text());assert T['exit']==0 and T['sourceSha256']==M['testSourceSha256']and '# fail 0'in T['summary']and '# skipped 0'in T['summary'],'FULL_TESTS_NOT_PASSED'
 stable(S);quiet();a=inspect(API);assert a['Image']==M['baseImageId']and env(a)==env(S['beforeApi']),'ACTUAL_BASE_CHANGED'
 assert sourcehashes(API)==S['sourceHashes'],'BASE_APPLICATION_DRIFT'
 R.write_text(json.dumps(S['override']));R.chmod(0o600)
 (D/'apply-intent.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'revision':M['revision']}))
 run(compose(S)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel'])
 proof=verify(S);(D/'applied.json').write_text(json.dumps(proof));print(json.dumps(proof))
elif phase=='verify':
 S=json.loads((D/'state.private.json').read_text());print(json.dumps(verify(S)))
elif phase=='rollback':
 S=json.loads((D/'state.private.json').read_text());stable(S);quiet()
 a=inspect(API);assert a['Image']in [M['baseImageId'],S['imageId']],'SUPERSEDING_RELEASE_DO_NOT_ROLLBACK'
 assert env(a)in [env(S['beforeApi']),S['newEnv']],'NEW_ENVIRONMENT_DO_NOT_RESTORE'
 R.write_text(json.dumps({'services':{'api':{'image':M['baseImage'],'environment':{k:v for k,v in env(S['beforeApi']).items()if k in ['SULEIA_BUILD_REVISION','SULEIA_BUILD_VERSION']}},'review-panel':{'volumes':[M['panelBase']+':/usr/share/nginx/html:ro']}}}));R.chmod(0o600)
 run(compose(S)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel']);healthy();stable(S)
 assert inspect(API)['Image']==M['baseImageId']and env(inspect(API))==env(S['beforeApi']),'PREDECESSOR_NOT_RESTORED'
 assert sourcehashes(API)==S['sourceHashes'],'PREDECESSOR_SOURCE_MISMATCH'
 proof={'capturedActualApplicationRestored':True,'botUntouched':True,'ledgerFlagsTimersFinancialPolicyNotRestoredOrChanged':True};(D/'rollback.json').write_text(json.dumps(proof));print(json.dumps(proof))
else:raise RuntimeError('UNKNOWN_PHASE')
