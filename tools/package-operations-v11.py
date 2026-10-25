"""Build auditable V11 overlays. No network, credentials, runtime change or deploy."""
import argparse,hashlib,io,json,pathlib,subprocess,tarfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
BASE='48bc7393c820b5105f5589ceacd5600b193a54c0'
API=['services/meta-ads/'+p+'.mjs' for p in ['meta-ads-client','report-cache','report-reader','report','runtime','request-scheduler','stored-report','review/analyze','review/service','review/growth-service','review/growth-trend']]
PANEL=['apps/review-panel/'+p for p in ['index.html','app.js','app-shell.css','operations-v11.css','ads-report-client.js','ads-review-v6.js','ads-growth-v10.js','ads-growth-v10.css','ads-growth-drawer-v10.js']]
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def sha(body):return hashlib.sha256(body.replace(b'\r\n',b'\n')).hexdigest()
def build(destination,audit,runtime):
 assert audit['sourceFiles']==audit['sourceMatches']==108 and not audit['sourceDifferences'],'Reaudit source drift first'
 assert audit['api']['revision']=='7224c11fad4a5557732da7c935ff3bef5d2c0f35'
 assert audit['api']['imageId']=='sha256:a02a3618de627d5dd9631e8e5a8f8e8bc505e57d09f1a82c9636d266a7f165aa'
 assert audit['panel']==runtime['panel']=='/opt/suleia-panel-releases/ads-growth-svg-b048ad5'
 assert runtime['protectedBudgetHashesMatch'] and len(runtime['protected'])==19
 for p in runtime['protected']:assert sha((ROOT/p['path']).read_bytes())==p['sha256'],'Protected source changed: '+p['path']
 assert not git('diff','HEAD','--name-only','--',*API,*PANEL).strip(),'Commit runtime changes before packaging'
 files=[]
 for p in API+PANEL:
  git('ls-files','--error-unmatch',p)
  previous=subprocess.run(['git','show',BASE+':'+p],cwd=ROOT,capture_output=True)
  files.append({'path':p,'surface':'api' if p in API else 'panel','before':sha(previous.stdout) if previous.returncode==0 else None,'after':sha((ROOT/p).read_bytes())})
 revision=git('rev-parse','HEAD').decode().strip();destination.mkdir(parents=True,exist_ok=True)
 manifest={'version':'suleia-operations-v11.0','revision':revision,'sourceBaseline':BASE,'auditAt':audit['at'],'apiBase':audit['api']['image'],'apiBaseImageId':audit['api']['imageId'],'apiBaseRevision':audit['api']['revision'],'panelBase':audit['panel'],'files':files,'protected':runtime['protected'],'botConfigHash':runtime['botConfigHash'],'deploymentApproved':False,'deployed':False,'migration':None,'newSecrets':False,'newMetaClient':False,'newRecipient':False,'newScheduledTask':False,'openaiBudgetUsd':0,'preserve':['V5.1 policy, flags, approvals, idempotence and ledgers','Existing writer with fresh critical GETs','OAuth/SSO and RBAC','Telegram consumer/token/22:30 Europe/Madrid delivery','Render confirmation/incident workers','Finance source, COGS and cohort rules','Shopify/Dropea/Chatby automations'],'rollback':{'image':audit['api']['image'],'imageId':audit['api']['imageId'],'panel':audit['panel'],'database':'No migration or ledger reset; retain audit records'}}
 docker='\n'.join(['FROM '+audit['api']['image'],'USER root',*['COPY '+p+' /app/'+p for p in API],'ENV SULEIA_BUILD_REVISION='+revision,'LABEL org.opencontainers.image.revision='+revision,'USER suleia'])+'\n'
 for name,paths in [('api',API),('panel',PANEL)]:
  with tarfile.open(destination/('operations-v11-'+name+'.tar.gz'),'w:gz') as archive:
   for p in paths:
    body=(ROOT/p).read_bytes().replace(b'\r\n',b'\n');member=tarfile.TarInfo(p);member.size=len(body);member.mode=0o644;member.mtime=0;archive.addfile(member,io.BytesIO(body))
   if name=='api':
    body=docker.encode();member=tarfile.TarInfo('Dockerfile');member.size=len(body);member.mode=0o644;member.mtime=0;archive.addfile(member,io.BytesIO(body))
 manifest['artifacts']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.glob('operations-v11-*.tar.gz')}
 (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'revision':revision,'runtimeFiles':len(files),'protectedFiles':19,'deploymentApproved':False,'artifacts':manifest['artifacts']}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--audit',required=True,type=pathlib.Path);parser.add_argument('--runtime',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);args=parser.parse_args()
 build(args.output,json.loads(args.audit.read_text(encoding='utf-8-sig')),json.loads(args.runtime.read_text(encoding='utf-8-sig')))
