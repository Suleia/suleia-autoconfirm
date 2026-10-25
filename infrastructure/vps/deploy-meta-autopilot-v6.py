"""Exact overlay of the captured production base. Run as root with a manifest.

Never restores financial data, reservations, Telegram offsets or customer state.
Rollback retains the actual preceding application base and disables budget writes.
"""
import os,pathlib,subprocess,json,hashlib,fcntl,datetime,time,sys,tarfile,shutil,re
from zoneinfo import ZoneInfo
assert os.geteuid()==0
os.umask(0o077)
M=json.loads(pathlib.Path(sys.argv[2]).read_text());short=M['revision'][:7]
D=pathlib.Path('/root/suleia-meta-v6-deploy')/short;D.mkdir(parents=True,exist_ok=True,mode=0o700)
API='suleia-operations-staging-api-1';PANEL='suleia-operations-staging-review-panel-1';DB='suleia-operations-staging-postgres-1'
R=pathlib.Path(M.get('runtimeOverride','/etc/suleia/meta-autopilot-v6-runtime.json'));BOT=pathlib.Path('/opt/suleia-telegram');BENV=pathlib.Path('/etc/suleia/telegram.env')
def run(args,body=None):
 p=subprocess.run(args,input=body,capture_output=True)
 if p.returncode:(D/'error.private.log').write_bytes(p.stdout+b'\n'+p.stderr);raise RuntimeError('DEPLOY_COMMAND_FAILED_PRIVATE_LOG')
 return p.stdout
def inspect(n):return json.loads(run(['docker','inspect',n]))[0]
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def env(x):return dict(v.split('=',1)for v in x['Config']['Env'])
def sql(q,readonly=True):
 text=('BEGIN READ ONLY;'+q+';COMMIT;')if readonly else q
 return run(['docker','exec','-i',DB,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','suleia_admin','-d','suleia_staging'],text.encode()).decode()
def one(q):return next(x for x in sql('SELECT '+q).splitlines()if x not in ['BEGIN','COMMIT',''])
def ids():return {r['Names']:r['ID']for r in [json.loads(x)for x in run(['docker','ps','--no-trunc','--format','{{json .}}']).decode().splitlines()]}
def critical_files():
 paths=['/etc/suleia/shopify-dropea-recovery.env','/etc/systemd/system/suleia-shopify-dropea-recovery.service','/etc/systemd/system/suleia-shopify-dropea-recovery.timer','/etc/suleia/address-import-recovery-shadow.env','/etc/systemd/system/suleia-address-import-recovery-shadow.path','/etc/systemd/system/suleia-address-import-recovery-shadow.service']
 return {p:sha(pathlib.Path(p).read_bytes())for p in paths}
def quiet():
 n=datetime.datetime.now(ZoneInfo('Europe/Madrid'));minute=n.hour*60+n.minute
 assert all(abs(minute-t)>6 for t in [8*60,10*60,12*60,16*60,18*60,22*60+30]),'BUDGET_WINDOW_RETRY_LATER'
 for table,states in [('ads_operations',"'UNKNOWN','EXECUTING'"),('ads_autopilot_slots',"'EXECUTING'"),('ads_executive_deliveries',"'SENDING'"),('ads_executive_reports',"'PREPARING'")]:assert one('count(*) FROM economics.'+table+' WHERE state IN ('+states+')')=='0','FINANCIAL_OPERATION_IN_PROGRESS'
def compose(S):
 a=['docker','compose','-p','suleia-operations-staging','--env-file',S['envFile']]
 for p in S['composeFiles']+[str(R)]:a+=['-f',p]
 return a
def health():
 for _ in range(45):
  if inspect(API)['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(1)
 raise RuntimeError('API_NOT_HEALTHY')
def stable(S):
 assert critical_files()==S['criticalFiles'],'UNRELATED_AUTOMATION_CHANGED'
 assert one("md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY rate_id)::text,'[]')) FROM economics.finance_cost_rates r")==S['financeHash'],'FINANCE_CHANGED'
 now=ids();assert all(now.get(k)==v for k,v in S['containers'].items()if k not in [API,PANEL]),'UNRELATED_CONTAINER_CHANGED'
 for p,h in S['composeHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h,'PRECEDING_COMPOSE_CHANGED'
 assert sha(pathlib.Path('/etc/systemd/system/suleia-telegram.service').read_bytes())==S['botUnitHash'],'BOT_UNIT_CHANGED'
def verify(S):
 health();stable(S);actual=inspect(API)
 assert actual['Image']==S['imageId'],'API_IMAGE_CHANGED'
 assert env(actual)==S['newEnv'],'API_ENV_DRIFT'
 for f in M['apiFiles']:assert sha(run(['docker','exec',API,'cat','/app/'+f['path']]))==f['after'],'API_FILE_MISMATCH'
 panel=next(m['Source']for m in inspect(PANEL)['Mounts']if m['Destination']=='/usr/share/nginx/html');assert panel==S['panel'],'PANEL_MOUNT_CHANGED'
 for f in M['panelFiles']:assert sha((pathlib.Path(panel)/pathlib.Path(f['path']).name).read_bytes())==f['after'],'PANEL_FILE_MISMATCH'
 changed={pathlib.Path(f['path']).name for f in M['panelFiles']}
 for p,h in S['staticHashes'].items():
  if p not in changed:assert sha((pathlib.Path(panel)/p).read_bytes())==h,'UNRELATED_STATIC_CHANGED'
 assert BOT.resolve()==pathlib.Path(S['bot']),'BOT_RELEASE_CHANGED'
 for f in M['botFiles']:assert sha((pathlib.Path(S['bot'])/pathlib.Path(f['path']).name).read_bytes())==f['after'],'BOT_FILE_MISMATCH'
 for name,h in S['botPreservedHashes'].items():assert sha((pathlib.Path(S['bot'])/name).read_bytes())==h,'UNRELATED_BOT_CODE_CHANGED'
 assert sha(BENV.read_bytes())==S['newBotEnvHash'],'BOT_ENV_CHANGED'
 assert run(['systemctl','is-active','suleia-telegram.service']).decode().strip()=='active','BOT_INACTIVE'
 assert one("count(*) FROM pg_indexes WHERE schemaname='economics' AND indexname='ads_operations_one_night_per_campaign_day'")=='1','NIGHT_GUARD_MISSING'
 return {'revision':M['revision'],'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'healthy':True,'mode':'LIVE','policyVersion':'SULEIA_META_AUTOPILOT_V6','aggregateIncreaseCents':M['approved']['aggregateIncreaseCents'],'minimumCents':1500,'campaignMaximumCents':10000,'globalConfiguredMaximumCents':100000,'image':M['image'],'imageId':S['imageId'],'panel':S['panel'],'bot':S['bot'],'apiFilesVerified':len(M['apiFiles']),'unrelatedContainersAndAutomationsPreserved':True,'financePreserved':True,'existingTelegramUnitAndAdministratorsPreserved':True,'nightGuardPresent':True,'financialWritesVerifiedByThisDeploymentCheck':0}
phase=sys.argv[1]
lock=open('/run/lock/suleia-budget-v51-deploy.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if phase=='stage':
 assert not(D/'state.private.json').exists()and not R.exists(),'ALREADY_STAGED_RECONCILE'
 a=inspect(API);p=inspect(PANEL);assert a['Image']==M['baseImageId']and a['Config']['Image']==M['baseImage'],'BASE_CHANGED'
 files=a['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
 priorPanel=next(pathlib.Path(m['Source'])for m in p['Mounts']if m['Destination']=='/usr/share/nginx/html');assert str(priorPanel)==M['panelBase'],'PANEL_BASE_CHANGED'
 assert BOT.is_symlink(),'BOT_NOT_MANAGED_SYMLINK'
 previousBot=BOT.resolve();assert str(previousBot)==M['botBase'],'BOT_BASE_CHANGED'
 S={'beforeApi':a,'beforePanel':p,'composeFiles':files,'composeHashes':{x:sha(pathlib.Path(x).read_bytes())for x in files},'envFile':'/opt/suleia-releases/7d701365723507969b32ff0601b01f4fdc7dc615/.env','containers':ids(),'criticalFiles':critical_files(),'financeHash':one("md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY rate_id)::text,'[]')) FROM economics.finance_cost_rates r"),'staticHashes':{str(x.relative_to(priorPanel)):sha(x.read_bytes())for x in priorPanel.rglob('*')if x.is_file()},'panel':'/opt/suleia-panel-releases/meta-autopilot-v6-'+short,'previousBot':str(previousBot),'bot':'/opt/suleia-meta-autopilot-releases/'+short+'/infrastructure/telegram-center','botUnitHash':sha(pathlib.Path('/etc/systemd/system/suleia-telegram.service').read_bytes()),'botEnvHash':sha(BENV.read_bytes())}
 shutil.copyfile(BENV,D/'telegram-before.private.env')
 source=D/'source';source.mkdir(mode=0o700)
 archive=pathlib.Path(M['archive']);assert hashlib.sha256(archive.read_bytes()).hexdigest()==M['archiveSha256'],'ARCHIVE_MISMATCH'
 allowed={f['path']for k in ['apiFiles','botFiles','panelFiles','sqlFiles']for f in M[k]}|{'Dockerfile'}
 with tarfile.open(archive)as ar:
  for f in ar.getmembers():assert f.isfile()and f.name in allowed and(source/f.name).resolve().is_relative_to(source),'UNSAFE_ARCHIVE'
  ar.extractall(source,filter='data')
 for k in ['apiFiles','botFiles','panelFiles','sqlFiles']:
  for f in M[k]:assert sha((source/f['path']).read_bytes())==f['after'],'SOURCE_MISMATCH'
 for f in M['apiFiles']:
  q=subprocess.run(['docker','exec',API,'cat','/app/'+f['path']],capture_output=True);assert(sha(q.stdout)if q.returncode==0 else None)==f['before'],'API_BASE_FILE_CHANGED:'+f['path']
 for f in M['botFiles']:assert sha((previousBot/pathlib.Path(f['path']).name).read_bytes())==f['before'],'BOT_BASE_FILE_CHANGED:'+f['path']
 for f in M['panelFiles']:assert sha((priorPanel/pathlib.Path(f['path']).name).read_bytes())==f['before'],'PANEL_BASE_FILE_CHANGED'
 run(['docker','build','--network','none','--pull=false','-t',M['image'],str(source)]);S['imageId']=inspect(M['image'])['Id']
 updates={'AUTOPILOT_APPROVED_POLICY_JSON':json.dumps(M['approved'],separators=(',',':')),'ADS_MAX_AGGREGATE_INCREASE_EUR':str(M['approved']['aggregateIncreaseCents']//100),'MAX_DAY_BUDGET_EUR':'100','META_MAX_DAILY_BUDGET_EUR':'100','SULEIA_BUILD_REVISION':M['revision'],'SULEIA_BUILD_VERSION':'suleia-meta-autopilot-v6'}
 S['newEnv']={**env(a),**updates};assert S['newEnv']['META_WRITES_ENABLED']=='false'
 private=D/'candidate.private.env';private.write_text('\n'.join(k+'='+v for k,v in S['newEnv'].items())+'\n')
 # Both mode configurations compile without a network or production SQL. There
 # is no API server, timer, polling loop, assigning POST or startup read here.
 code="import {createAdsRuntime} from './services/meta-ads/runtime.mjs';const r=createAdsRuntime({pool:{}});console.log(JSON.stringify({uid:process.getuid(),mode:r.engine.mode,version:r.autopilot.config.policy.version,cap:r.engine.policy.maxBudgetCents,aggregate:r.engine.policy.maxAggregateIncreaseCents}));"
 safe=['docker','run','--rm','--network','none','--read-only','--memory','256m','--env-file',str(private),'--entrypoint','node']
 check=json.loads(run(safe+['-e','AUTOPILOT_MODE=SHADOW','-e','AUTOPILOT_LIVE_AUTHORIZED=false','-e','ADS_INTELLIGENCE_MODE=SHADOW','-e','ADS_INTELLIGENCE_WRITES_ENABLED=false',M['image'],'--input-type=module','-e',code]));assert check['mode']=='SHADOW'and check['uid']!=0 and check['cap']==10000
 live=json.loads(run(safe+[M['image'],'--input-type=module','-e',code]));assert live['mode']=='LIVE'and live['aggregate']==36000 and live['version']=='SULEIA_META_AUTOPILOT_V6'
 shutil.copytree(priorPanel,S['panel'])
 for f in M['panelFiles']:shutil.copyfile(source/f['path'],pathlib.Path(S['panel'])/pathlib.Path(f['path']).name)
 newBot=pathlib.Path(S['bot']);newBot.mkdir(parents=True,mode=0o755)
 # Copy code only. Never make a release-local env, offset, conversation or
 # private data file publicly readable while preparing a code release.
 changedBot={pathlib.Path(f['path']).name for f in M['botFiles']}
 S['botPreservedHashes']={}
 for file in previousBot.iterdir():
  if file.is_file()and file.suffix in ['.mjs','.py']and not file.name.endswith('.test.mjs'):
   shutil.copyfile(file,newBot/file.name)
   if file.name not in changedBot:S['botPreservedHashes'][file.name]=sha(file.read_bytes())
 newBot.parent.parent.parent.chmod(0o755)
 for f in M['botFiles']:shutil.copyfile(source/f['path'],newBot/pathlib.Path(f['path']).name)
 cap=newBot.parent.parent/'services/meta-ads/budget-cap.mjs';cap.parent.mkdir(parents=True);shutil.copyfile(source/'services/meta-ads/budget-cap.mjs',cap)
 for root in [pathlib.Path(S['panel']),newBot.parent.parent]:
  for x in [root,*root.rglob('*')]:x.chmod(0o755 if x.is_dir()else 0o644)
 # Import all modified bot modules without starting polling or using tokens.
 pid=run(['systemctl','show','suleia-telegram.service','-p','MainPID','--value']).decode().strip()
 assert pid.isdigit()and int(pid)>0,'BOT_PROCESS_NOT_RUNNING'
 S['botNode']=os.readlink('/proc/'+pid+'/exe')
 assert pathlib.Path(S['botNode']).is_file()and run([S['botNode'],'-p','process.versions.node']).decode().startswith('22.'),'BOT_NODE_EXECUTABLE_UNVERIFIED'
 run([S['botNode'],'--input-type=module','-e',';'.join("await import('"+str(newBot/pathlib.Path(f['path']).name)+"')"for f in M['botFiles'])])
 text=BENV.read_text();text=re.sub(r'(?m)^AUTOPILOT_REPORT_POLICY_VERSION=.*\n?','',text).rstrip()+'\nAUTOPILOT_REPORT_POLICY_VERSION=SULEIA_META_AUTOPILOT_V6\n';(D/'telegram-new.private.env').write_text(text);S['newBotEnvHash']=sha(text.encode())
 S['override']={'services':{'api':{'image':M['image'],'environment':updates},'review-panel':{'volumes':[S['panel']+':/usr/share/nginx/html:ro']}}}
 (D/'state.private.json').write_text(json.dumps(S));(D/'manifest.json').write_text(json.dumps(M));shutil.copyfile(__file__,D/'deploy.py')
 print(json.dumps({'staged':True,'deployed':False,'revision':M['revision'],'imageId':S['imageId'],'networkIsolatedConfig':check,'networkIsolatedLiveConfig':live}))
elif phase=='apply':
 S=json.loads((D/'state.private.json').read_text());assert not(D/'applied.json').exists()
 T=json.loads(pathlib.Path(M['testReceipt']).read_text());assert T['exit']==0 and T['sourceSha256']==M['testSourceSha256']and '# fail 0'in T['summary']and'# skipped 0'in T['summary'],'TESTS_NOT_PASSED'
 stable(S);quiet();assert inspect(API)['Image']==M['baseImageId']and BOT.resolve()==pathlib.Path(S['previousBot'])and sha(BENV.read_bytes())==S['botEnvHash'],'BASE_CHANGED'
 backup=run(['docker','exec',DB,'pg_dump','-U','suleia_admin','-d','suleia_staging','--data-only','--table=economics.ads_operations','--table=economics.ads_proposals','--table=economics.ads_events','--table=economics.ads_autopilot_slots','--table=economics.ads_circuit']);(D/'ledger-before.private.sql').write_bytes(backup)
 if M.get('applyMigration',True):sql((D/'source/migrations/061_meta_autopilot_v6_night_guard.sql').read_text(),False)
 else:assert one("count(*) FROM pg_indexes WHERE schemaname='economics' AND indexname='ads_operations_one_night_per_campaign_day'")=='1','EXISTING_NIGHT_GUARD_REQUIRED'
 try:
  R.write_text(json.dumps(S['override']));R.chmod(0o600)
  run(['systemctl','stop','suleia-telegram.service'])
  run(compose(S)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel']);health()
  link=BOT.with_name('suleia-telegram-v6-next');assert not link.exists();link.symlink_to(S['bot']);os.replace(link,BOT)
  shutil.copyfile(D/'telegram-new.private.env',BENV);BENV.chmod(0o600);run(['systemctl','start','suleia-telegram.service'])
  proof=verify(S);(D/'applied.json').write_text(json.dumps(proof));print(json.dumps(proof))
 except Exception:
  (D/'rollback-required').write_text('Budget lane must be disabled on the captured actual application. Never restore ledger or bot offsets. Run rollback with this exact manifest.')
  # Leave the original exception and its private diagnostic intact. Explicit
  # rollback runs below and refuses a superseding deployment.
  raise
elif phase=='verify':
 S=json.loads((D/'state.private.json').read_text());print(json.dumps(verify(S)))
elif phase=='rollback':
 S=json.loads((D/'state.private.json').read_text());assert inspect(API)['Image']in [M['baseImageId'],S['imageId']],'SUPERSEDED_RELEASE_DO_NOT_ROLLBACK'
 assert one("count(*) FROM economics.ads_operations WHERE state='EXECUTING'")=='0','INFLIGHT_FINANCIAL_OPERATION_RECONCILE'
 off={'AUTOPILOT_ENABLED':'false','AUTOPILOT_MODE':'SHADOW','AUTOPILOT_LIVE_AUTHORIZED':'false','ADS_INTELLIGENCE_MODE':'SHADOW','ADS_INTELLIGENCE_WRITES_ENABLED':'false','META_WRITES_ENABLED':'false'}
 off.update({k:v for k,v in env(S['beforeApi']).items()if k in ['AUTOPILOT_APPROVED_POLICY_JSON','ADS_MAX_AGGREGATE_INCREASE_EUR','MAX_DAY_BUDGET_EUR','META_MAX_DAILY_BUDGET_EUR','SULEIA_BUILD_REVISION','SULEIA_BUILD_VERSION']})
 priorPanel=next(m['Source']for m in S['beforePanel']['Mounts']if m['Destination']=='/usr/share/nginx/html')
 R.write_text(json.dumps({'services':{'api':{'image':M['baseImage'],'environment':off},'review-panel':{'volumes':[priorPanel+':/usr/share/nginx/html:ro']}}}));R.chmod(0o600)
 run(['systemctl','stop','suleia-telegram.service']);run(compose(S)+['up','-d','--no-deps','--no-build','--pull','never','api','review-panel']);health()
 link=BOT.with_name('suleia-telegram-rollback-next');link.symlink_to(S['previousBot']);os.replace(link,BOT)
 text=(D/'telegram-before.private.env').read_text();text=re.sub(r'(?m)^COMMAND_CENTER_BUDGET_WRITES_ENABLED=.*$', 'COMMAND_CENTER_BUDGET_WRITES_ENABLED=false',text);BENV.write_text(text);BENV.chmod(0o600);run(['systemctl','start','suleia-telegram.service']);stable(S)
 proof={'restoredCapturedActualApplication':True,'budgetWritesStopped':True,'ledgerAndReservationsPreserved':True,'telegramOffsetsPreserved':True,'noFinancialStateRestored':True};(D/'rolled-back.json').write_text(json.dumps(proof));print(json.dumps(proof))
else:raise RuntimeError('UNKNOWN_PHASE')
