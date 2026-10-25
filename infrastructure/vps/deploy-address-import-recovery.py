"""Phase1 only. Run as root with an exact private manifest: stage/apply/verify/rollback.

Never deploys the live engine or enables provider writes. No normal importer
file/config/unit/ledger is changed. Private receipts stay on the VPS.
"""
import os,pathlib,subprocess,json,hashlib,fcntl,datetime,time,sys,tarfile,shutil,secrets
from zoneinfo import ZoneInfo

assert os.geteuid()==0
os.umask(0o077)
M=json.loads(pathlib.Path(sys.argv[2]).read_text());short=M['revision'][:7]
D=pathlib.Path('/root/suleia-address-import-recovery-deploy')/short;D.mkdir(parents=True,exist_ok=True,mode=0o700)
API='suleia-operations-staging-api-1';PANEL='suleia-operations-staging-review-panel-1';DB='suleia-operations-staging-postgres-1'
R=pathlib.Path('/etc/suleia/address-import-recovery-panel-runtime.json')
WORKER=pathlib.Path('/opt/suleia-address-import-recovery');STATE=pathlib.Path('/var/lib/suleia-address-import-recovery');PUBLIC=pathlib.Path('/var/lib/suleia-address-import-recovery-panel')
ENV=pathlib.Path('/etc/suleia/address-import-recovery-shadow.env');UNIT='suleia-address-import-recovery-shadow'

def run(args,body=None):
 p=subprocess.run(args,input=body,capture_output=True)
 if p.returncode:(D/'error.private.log').write_bytes(p.stdout+b'\n'+p.stderr);raise RuntimeError('DEPLOY_COMMAND_FAILED_PRIVATE_LOG')
 return p.stdout
def inspect(n):return json.loads(run(['docker','inspect',n]))[0]
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def sql(q):return next(x for x in run(['docker','exec','-i',DB,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','suleia_admin','-d','suleia_staging'],('BEGIN READ ONLY;SELECT '+q+';COMMIT;').encode()).decode().splitlines()if x not in ['BEGIN','COMMIT',''])
def ids():return{x['Names']:x['ID']for x in[json.loads(s)for s in run(['docker','ps','--filter','label=com.docker.compose.project=suleia-operations-staging','--no-trunc','--format','{{json .}}']).decode().splitlines()]}
def normal():
 root=pathlib.Path('/opt/suleia-shopify-dropea/current').resolve()
 files=[root/'autoconfirm/tools/recover-shopify-dropea.mjs',root/'autoconfirm/src/workflows/shopify-dropea-recovery.mjs',pathlib.Path('/etc/suleia/shopify-dropea-recovery.env'),pathlib.Path('/etc/systemd/system/suleia-shopify-dropea-recovery.service'),pathlib.Path('/etc/systemd/system/suleia-shopify-dropea-recovery.timer')]
 return {'release':str(root),'hashes':{str(p):sha(p.read_bytes())for p in files},'timerEnabled':run(['systemctl','is-enabled','suleia-shopify-dropea-recovery.timer']).decode().strip()}
def protected():
 for f in M['protected']:assert sha(run(['docker','exec',API,'cat','/app/'+f['path']]))==f['sha256'],'PROTECTED_HASH_CHANGED'
def stable(S,before=False):
 protected();assert normal()==S['normal'],'NORMAL_IMPORTER_CHANGED'
 assert sha(pathlib.Path('/etc/suleia/telegram.env').read_bytes())==S['botHash'],'BOT_CONFIG_CHANGED'
 assert run(['systemctl','show','suleia-telegram.service','-p','MainPID','--value']).decode().strip()==S['botPid'],'BOT_PID_CHANGED'
 assert sql("md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY rate_id)::text,'[]')) FROM economics.finance_cost_rates r")==S['financeRatesHash'],'FINANCE_CHANGED'
 current=ids();assert all(current.get(k)==v for k,v in S['containers'].items()if before or k not in [API,PANEL]),'UNRELATED_CONTAINER_CHANGED'
 for p,h in S['composeHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h,'COMPOSE_CHANGED'
def quiet():
 now=datetime.datetime.now(ZoneInfo('Europe/Madrid'));minute=now.hour*60+now.minute
 slots=[h*60 for h in range(7,23)]+[1350,1365,1380,1395,1410,1425,1439]
 assert all(abs(minute-t)>5 for t in slots),'BUDGET_WINDOW_RETRY_LATER'
 for table,states in [('ads_operations',"'UNKNOWN','EXECUTING'"),('ads_autopilot_slots',"'EXECUTING'"),('ads_executive_deliveries',"'SENDING'"),('ads_executive_reports',"'PREPARING'")]:assert sql('count(*) FROM economics.'+table+' WHERE state IN ('+states+')')=='0','BUSINESS_OPERATION_IN_PROGRESS'
def compose(S,new=True):
 a=['docker','compose','-p','suleia-operations-staging','--env-file',S['envFile']]
 for p in S['composeFiles']+([str(R)]if new else[]):a+=['-f',p]
 return a
def health():
 for _ in range(45):
  if inspect(API)['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(1)
 raise RuntimeError('API_NOT_HEALTHY')
def extract(archive,target,allowed,expected):
 assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected,'ARCHIVE_MISMATCH'
 target.mkdir(parents=True,mode=0o755)
 with tarfile.open(archive)as a:
  for f in a.getmembers():assert f.isfile()and f.name in allowed and(target/f.name).resolve().is_relative_to(target),'UNSAFE_ARCHIVE'
  a.extractall(target,filter='data')
 for p in [target,*target.rglob('*')]:p.chmod(0o755 if p.is_dir()else 0o644)
def verify(S):
 stable(S);assert inspect(API)['Image']==S['imageId'];protected()
 count=0
 for f in M['apiFiles']:assert sha(run(['docker','exec',API,'cat','/app/'+f['path']]))==f['after'];count+=1
 for f in M['panelFiles']:assert sha((pathlib.Path(S['panel'])/pathlib.Path(f['path']).name).read_bytes())==f['after'];count+=1
 allowed={pathlib.Path(f['path']).name for f in M['panelFiles']}
 for p,h in S['staticHashes'].items():
  if p not in allowed:assert sha((pathlib.Path(S['panel'])/p).read_bytes())==h,'UNRELATED_STATIC_CHANGED'
 expected=dict(v.split('=',1)for v in S['beforeApi']['Config']['Env']);expected.update(SULEIA_BUILD_REVISION=M['revision'],SULEIA_BUILD_VERSION='suleia-address-recovery-shadow-v1',ADDRESS_RECOVERY_PANEL_FILE='/run/suleia-import-recovery/overview.json')
 assert dict(v.split('=',1)for v in inspect(API)['Config']['Env'])==expected,'API_ENV_DRIFT'
 report=json.loads((PUBLIC/'overview.json').read_text());assert report['mode']=='SHADOW'and report['providerRequests']==0 and report['externalActions']==0
 assert report['writes']=={'shopify':False,'chatby':False,'dropea':False}
 assert run(['systemctl','is-active',UNIT+'.path']).decode().strip()=='active'
 sandbox=run(['systemctl','show',UNIT+'.service','-p','PrivateNetwork','--value']).decode().strip();assert sandbox=='yes'
 assert (WORKER/'current').resolve()==pathlib.Path(S['worker'])
 for f in M['workerFiles']:assert sha((pathlib.Path(S['worker'])/f['path']).read_bytes())==f['after'],'WORKER_SOURCE_CHANGED'
 return {'revision':M['revision'],'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'healthy':True,'verifiedFiles':count,'normalImporterUnchanged':True,'normalImporterConfigurationAndTimerUnchanged':True,'protectedBudgetFiles':len(M['protected']),'unrelatedContainersPreserved':True,'botAndFinancePreserved':True,'mode':'SHADOW','networkIsolated':True,'providerRequests':0,'externalActions':0,'metrics':report['metrics'],'image':M['image'],'imageId':S['imageId'],'panel':S['panel']}

phase=sys.argv[1];lock=open('/run/lock/suleia-budget-v51-deploy.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if phase=='stage':
 assert not(D/'state.private.json').exists()and not R.exists(),'ALREADY_STAGED_RECONCILE'
 assert not ENV.exists()and not WORKER.exists(),'RECOVERY_ALREADY_INSTALLED_RECONCILE'
 api=inspect(API);panel=inspect(PANEL);protected()
 assert api['Image']==M['baseImageId']and api['Config']['Image']==M['baseImage'],'API_BASE_CHANGED'
 oldPanel=next(pathlib.Path(m['Source'])for m in panel['Mounts']if m['Destination']=='/usr/share/nginx/html');assert str(oldPanel)==M['panelBase'],'PANEL_BASE_CHANGED'
 files=api['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
 S={'beforeApi':api,'beforePanel':panel,'composeFiles':files,'composeHashes':{p:sha(pathlib.Path(p).read_bytes())for p in files},'envFile':'/opt/suleia-releases/7d701365723507969b32ff0601b01f4fdc7dc615/.env','containers':ids(),'normal':normal(),'botHash':sha(pathlib.Path('/etc/suleia/telegram.env').read_bytes()),'botPid':run(['systemctl','show','suleia-telegram.service','-p','MainPID','--value']).decode().strip(),'financeRatesHash':sql("md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY rate_id)::text,'[]')) FROM economics.finance_cost_rates r"),'staticHashes':{str(p.relative_to(oldPanel)):sha(p.read_bytes())for p in oldPanel.rglob('*')if p.is_file()},'panel':'/opt/suleia-panel-releases/address-import-recovery-'+short,'worker':str(WORKER/'releases'/M['revision'])}
 source=D/'source';extract(pathlib.Path(M['archive']),source,{f['path']for group in ['apiFiles','panelFiles','workerFiles']for f in M[group]}|{'Dockerfile'},M['archiveSha256'])
 for group in ['apiFiles','panelFiles','workerFiles']:
  for f in M[group]:assert sha((source/f['path']).read_bytes())==f['after']
 for f in M['apiFiles']:
  p=subprocess.run(['docker','exec',API,'cat','/app/'+f['path']],capture_output=True);assert(sha(p.stdout)if p.returncode==0 else None)==f['before'],'API_SOURCE_CHANGED'
 for f in M['panelFiles']:
  p=oldPanel/pathlib.Path(f['path']).name;assert(sha(p.read_bytes())if p.exists()else None)==f['before'],'PANEL_SOURCE_CHANGED'
 run(['docker','build','--network','none','--pull=false','-t',M['image'],str(source)]);S['imageId']=inspect(M['image'])['Id']
 smoke=run(['docker','run','--rm','--network','none','--read-only','--memory','256m','--pids-limit','128','-w','/app','--entrypoint','node',M['image'],'--input-type=module','-e',"await import('./apps/api/server.mjs'); console.log(JSON.stringify({uid:process.getuid(),imported:true}));"]);S['smoke']=json.loads(smoke);assert S['smoke']['uid']!=0
 shutil.copytree(oldPanel,S['panel'])
 for f in M['panelFiles']:shutil.copyfile(source/f['path'],pathlib.Path(S['panel'])/pathlib.Path(f['path']).name)
 for p in [pathlib.Path(S['panel']),*pathlib.Path(S['panel']).rglob('*')]:p.chmod(0o755 if p.is_dir()else 0o644)
 S['override']={'services':{'api':{'image':M['image'],'environment':{'SULEIA_BUILD_REVISION':M['revision'],'SULEIA_BUILD_VERSION':'suleia-address-recovery-shadow-v1','ADDRESS_RECOVERY_PANEL_FILE':'/run/suleia-import-recovery/overview.json'},'volumes':[str(PUBLIC)+':/run/suleia-import-recovery:ro']},'review-panel':{'volumes':[S['panel']+':/usr/share/nginx/html:ro']}}}
 (D/'state.private.json').write_text(json.dumps(S));(D/'manifest.json').write_text(json.dumps(M));shutil.copyfile(__file__,D/'deploy.py')
 print(json.dumps({'staged':True,'revision':M['revision'],'deployed':False,'imageId':S['imageId'],'smoke':S['smoke']}))
elif phase=='apply':
 S=json.loads((D/'state.private.json').read_text());assert not(D/'applied.json').exists()
 T=json.loads(pathlib.Path(M['testReceipt']).read_text());assert T['exit']==0 and T['sourceSha256']==M['testSourceSha256']and '# fail 0'in T['summary']and'# skipped 0'in T['summary'],'TESTS_NOT_PASSED'
 stable(S,before=True);quiet()
 try:
  pathlib.Path(S['worker']).mkdir(parents=True,mode=0o755)
  for f in M['workerFiles']:
   dest=pathlib.Path(S['worker'])/f['path'];dest.parent.mkdir(parents=True,exist_ok=True,mode=0o755);shutil.copyfile(D/'source'/f['path'],dest);dest.chmod(0o644)
  for p in [WORKER,WORKER/'releases',pathlib.Path(S['worker']),*pathlib.Path(S['worker']).rglob('*')]:p.chmod(0o755 if p.is_dir()else 0o644)
  (WORKER/'current').symlink_to(pathlib.Path(S['worker']))
  for p,mode in [(STATE,0o700),(PUBLIC,0o755)]:p.mkdir(mode=mode);shutil.chown(p,user='suleiaops',group='suleiaops');p.chmod(mode)
  ENV.write_text('ADDRESS_RECOVERY_PRIVATE_KEY='+secrets.token_urlsafe(48)+'\nADDRESS_RECOVERY_SHOP=vcnby0-h1.myshopify.com\nADDRESS_RECOVERY_STORE_ID=16088\n');ENV.chmod(0o600)
  for ext in ['service','path']:
   dest=pathlib.Path('/etc/systemd/system')/(UNIT+'.'+ext);assert not dest.exists();shutil.copyfile(D/'source'/'infrastructure/vps'/dest.name,dest);dest.chmod(0o644)
  run(['systemctl','daemon-reload']);run(['systemctl','start',UNIT+'.service'])
  R.write_text(json.dumps(S['override']));R.chmod(0o600)
  quiet();run(compose(S)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel']);health()
  run(['systemctl','enable','--now',UNIT+'.path']);proof=verify(S);(D/'applied.json').write_text(json.dumps(proof));print(json.dumps(proof))
 except Exception:
  subprocess.run(['systemctl','disable','--now',UNIT+'.path'],capture_output=True)
  run(compose(S,False)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel']);R.unlink(missing_ok=True)
  (D/'rollback-triggered').write_text('Restored captured API/static. Shadow disabled. Preserve private recovery DB and key; reconcile before resuming.')
  raise
elif phase=='verify':
 S=json.loads((D/'state.private.json').read_text());health();print(json.dumps(verify(S)))
elif phase=='rollback':
 S=json.loads((D/'state.private.json').read_text());assert inspect(API)['Image']==S['imageId']and json.loads(R.read_text())==S['override'],'SUPERSEDED_RELEASE_DO_NOT_ROLLBACK'
 quiet();run(['systemctl','disable','--now',UNIT+'.path']);run(['systemctl','stop',UNIT+'.service']);run(compose(S,False)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel']);R.unlink()
 print(json.dumps({'restoredCapturedApiAndPanel':True,'normalImporterUnchanged':normal()==S['normal'],'claimsPreserved':True}))
else:raise RuntimeError('UNKNOWN_PHASE')
