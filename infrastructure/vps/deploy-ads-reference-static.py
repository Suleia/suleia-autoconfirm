"""Static-only Ads presentation overlay. Never restart API/bot or restore state."""
import pathlib,subprocess,json,hashlib,fcntl,datetime,sys,os,shutil,tarfile
assert os.geteuid()==0
os.umask(0o077)
M=json.loads(pathlib.Path(sys.argv[2]).read_text());short=M['revision'][:7]
D=pathlib.Path('/root/suleia-ads-reference-deploy')/short
D.mkdir(parents=True,exist_ok=True,mode=0o700)
R=pathlib.Path('/etc/suleia/ads-reference-static-'+short+'.json')
PANEL='suleia-operations-staging-review-panel-1';API='suleia-operations-staging-api-1'
def run(a):
 p=subprocess.run(a,capture_output=True)
 if p.returncode:
  (D/'error.private.log').write_bytes(p.stdout+b'\n'+p.stderr)
  raise RuntimeError('COMMAND_FAILED_PRIVATE_DIAGNOSTIC')
 return p.stdout
def inspect(n):return json.loads(run(['docker','inspect',n]))[0]
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def files(p):return {str(x.relative_to(p)):sha(x.read_bytes())for x in pathlib.Path(p).rglob('*')if x.is_file()}
def mount():return next(m['Source']for m in inspect(PANEL)['Mounts']if m['Destination']=='/usr/share/nginx/html')
def ids():return {r['Names']:r['ID']for r in [json.loads(x)for x in run(['docker','ps','--no-trunc','--format','{{json .}}']).decode().splitlines()]}
def protected():
 paths=['/etc/suleia/telegram.env','/etc/systemd/system/suleia-telegram.service','/etc/suleia/shopify-dropea-recovery.env','/etc/systemd/system/suleia-shopify-dropea-recovery.timer','/etc/systemd/system/suleia-shopify-dropea-recovery.service','/etc/suleia/address-import-recovery-shadow.env','/etc/systemd/system/suleia-address-import-recovery-shadow.path','/etc/systemd/system/suleia-address-import-recovery-shadow.service']
 return {p:sha(pathlib.Path(p).read_bytes())for p in paths}
def botpid():return run(['systemctl','show','suleia-telegram.service','-p','MainPID','--value']).decode().strip()
def compose(S,new):
 a=['docker','compose','-p','suleia-operations-staging','--env-file',S['envFile']]
 for p in S['composeFiles']+([str(R)]if new else []):a+=['-f',p]
 return a+['up','-d','--no-deps','review-panel']
def stable(S):
 a=inspect(API);assert a['Id']==S['api']['Id']and a['Image']==S['api']['Image']and a['Config']['Env']==S['api']['Config']['Env'],'API_CHANGED'
 assert protected()==S['protected']and botpid()==S['botPid'],'BOT_OR_AUTOMATION_CHANGED'
 current=ids();assert all(current.get(k)==v for k,v in S['containers'].items()if k!=PANEL),'UNRELATED_CONTAINER_CHANGED'
 assert all(sha(pathlib.Path(p).read_bytes())==h for p,h in S['composeHashes'].items()),'PRECEDING_COMPOSE_CHANGED'
def verify(S):
 stable(S);assert mount()==S['panel'],'PANEL_SUPERSEDED'
 expected={**S['staticHashes'],**{x['name']:x['after']for x in M['files']}}
 assert files(S['panel'])==expected,'STATIC_POSTCONDITION_FAILED'
 return {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'revision':M['revision'],'staticFilesVerified':len(expected),'apiContainerImageAndEnvironmentPreserved':True,'botPidAndConfigPreserved':True,'otherContainersAutomationsPreserved':True,'customerOrBudgetWrites':0,'panel':S['panel']}
phase=sys.argv[1]
lock=open('/run/lock/suleia-budget-v51-deploy.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if phase=='stage':
 assert not(D/'state.private.json').exists()and not R.exists(),'STAGE_EXISTS_RECONCILE'
 assert mount()==M['panelBase'],'ACTUAL_PANEL_BASE_CHANGED'
 a=inspect(API);assert a['Image']==M['apiBaseImageId'],'ACTUAL_API_BASE_CHANGED'
 p=inspect(PANEL);preceding=p['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
 S={'api':a,'containers':ids(),'protected':protected(),'botPid':botpid(),'prior':mount(),'staticHashes':files(mount()),'composeFiles':preceding,'composeHashes':{f:sha(pathlib.Path(f).read_bytes())for f in preceding},'envFile':'/opt/suleia-releases/7d701365723507969b32ff0601b01f4fdc7dc615/.env','panel':'/opt/suleia-panel-releases/ads-reference-'+short}
 assert S['botPid'].isdigit()and int(S['botPid'])>0,'BOT_NOT_RUNNING'
 archive=pathlib.Path(M['archive']);assert hashlib.sha256(archive.read_bytes()).hexdigest()==M['archiveSha256'],'ARCHIVE_CHANGED'
 source=D/'source';source.mkdir(mode=0o700);allowed={x['name']for x in M['files']}
 with tarfile.open(archive)as t:
  assert len(t.getmembers())==len(allowed),'ARCHIVE_MEMBER_COUNT_CHANGED'
  for f in t.getmembers():assert f.isfile()and f.name in allowed and(source/f.name).resolve().is_relative_to(source),'UNSAFE_ARCHIVE'
  t.extractall(source,filter='data')
 for f in M['files']:
  assert S['staticHashes'].get(f['name'])==f['before'],'STATIC_BASE_FILE_CHANGED'
  assert sha((source/f['name']).read_bytes())==f['after'],'SOURCE_HASH_CHANGED'
 shutil.copytree(S['prior'],S['panel'])
 for f in M['files']:shutil.copyfile(source/f['name'],pathlib.Path(S['panel'])/f['name'])
 for f in [pathlib.Path(S['panel']),*pathlib.Path(S['panel']).rglob('*')]:f.chmod(0o755 if f.is_dir()else 0o644)
 (D/'state.private.json').write_text(json.dumps(S));(D/'manifest.json').write_text(json.dumps(M));shutil.copyfile(__file__,D/'deploy.py')
 print(json.dumps({'staged':True,'revision':M['revision'],'staticOnly':True,'predecessor':S['prior'],'rollbackPrepared':True}))
else:
 S=json.loads((D/'state.private.json').read_text());assert json.loads((D/'manifest.json').read_text())==M,'MANIFEST_CHANGED';stable(S)
 if phase=='apply':
  assert mount()==S['prior']and not R.exists(),'APPLY_ALREADY_STARTED_RECONCILE'
  R.write_text(json.dumps({'services':{'review-panel':{'volumes':[S['panel']+':/usr/share/nginx/html:ro']}}}))
  run(compose(S,True));result=verify(S);(D/'verified.json').write_text(json.dumps(result));print(json.dumps(result))
 elif phase=='verify':print(json.dumps(verify(S)))
 elif phase=='rollback':
  assert mount()==S['panel'],'SUPERSEDING_RELEASE_NO_ROLLBACK'
  run(compose(S,False));stable(S);assert mount()==S['prior']and files(S['prior'])==S['staticHashes'],'ROLLBACK_POSTCONDITION_FAILED'
  print(json.dumps({'rolledBack':True,'prior':S['prior'],'persistentStateRestored':False}))
 else:raise ValueError('UNKNOWN_PHASE')
