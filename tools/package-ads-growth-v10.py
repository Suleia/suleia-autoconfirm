"""Build reviewable V10 overlays only. This tool never connects or deploys."""
import argparse,hashlib,io,json,pathlib,subprocess,tarfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
API=['apps/api/server.mjs','packages/suleia-operations-mcp/src/operations/repository.mjs','services/meta-ads/runtime.mjs',
 'services/meta-ads/review/service.mjs',*['services/meta-ads/review/growth-'+p+'.mjs' for p in ['funnel','goals','periods','service','trend']],
 *['services/meta-ads/executive/'+p+'.mjs' for p in ['daily-decisions','report','service']]]
PANEL=['index.html','app.js','budget-autopilot-v5.js','ads-review-v6.js','ads-executive-v8.js','ads-daily-decisions-v9.css','ads-growth-v10.js','ads-growth-drawer-v10.js','ads-growth-v10.css']
PANEL=['apps/review-panel/'+p for p in PANEL]
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def build(destination,baseline):
 assert baseline['api']['revision']=='f72bf2cac58812d84b62a571853ed17b66e3f174','Reaudit changed production base before packaging'
 assert baseline['panel']=='/opt/suleia-panel-releases/finance-cogs-a2f2f4f'
 assert baseline['protectedBudgetHashesMatch'] and len(baseline['protected'])==19
 for p in baseline['protected']:assert sha((ROOT/p['path']).read_bytes())==p['sha256'],'Protected V5.1 source changed: '+p['path']
 assert not git('diff','HEAD','--name-only','--',*API,*PANEL).strip(),'Commit intentional runtime changes before packaging'
 for p in API+PANEL:git('ls-files','--error-unmatch',p)
 revision=git('rev-parse','HEAD').decode().strip();destination.mkdir(parents=True,exist_ok=True)
 files=[]
 for p in API+PANEL:
  prior=subprocess.run(['git','show',('f72bf2c' if p in API else 'a2f2f4f')+':'+p],cwd=ROOT,capture_output=True)
  files.append({'path':p,'surface':'api' if p in API else 'panel','before':sha(prior.stdout) if prior.returncode==0 else None,'after':sha((ROOT/p).read_bytes())})
 assert baseline['api']['imageId'].startswith('sha256:')
 manifest={'version':'suleia-growth-v10.0','revision':revision,'apiBase':baseline['api']['image'],'apiBaseImageId':baseline['api']['imageId'],'apiBaseRevision':baseline['api']['revision'],'panelBase':baseline['panel'],
  'files':files,'protected':baseline['protected'],'deploymentApproved':False,'deployed':False,'migration':None,'newSecrets':False,'newScheduler':False,'newRecipient':False,'openaiBudgetUsd':0,
  'preserve':['V5.1 flags/executor/monetary policy','OAuth roles','Telegram token/consumer/22:30 Madrid schedule/delivery ledger','financial COGS repair','orders/incidents/Shopify/Dropea'],
  'rollback':{'image':baseline['api']['image'],'panel':baseline['panel'],'database':'No schema migration; preserve append-only review history'}}
 docker='\n'.join(['FROM '+baseline['api']['image'],'USER root',*['COPY '+p+' /app/'+p for p in API],'ENV SULEIA_BUILD_REVISION='+revision,'LABEL org.opencontainers.image.revision='+revision,'USER suleia'])+'\n'
 for name,paths in [('api',API),('panel',PANEL)]:
  with tarfile.open(destination/('ads-growth-v10-'+name+'.tar.gz'),'w:gz') as archive:
   for p in paths:
    body=(ROOT/p).read_bytes().replace(b'\r\n',b'\n');member=tarfile.TarInfo(p);member.size=len(body);member.mode=0o644;member.mtime=0;archive.addfile(member,io.BytesIO(body))
   if name=='api':
    body=docker.encode();member=tarfile.TarInfo('Dockerfile');member.size=len(body);member.mode=0o644;archive.addfile(member,io.BytesIO(body))
 manifest['artifacts']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.glob('ads-growth-v10-*.tar.gz')}
 (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'revision':revision,'runtimeFiles':len(files),'protectedFiles':19,'deploymentApproved':False,'artifacts':manifest['artifacts']}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--baseline',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);args=parser.parse_args()
 build(args.output,json.loads(args.baseline.read_text(encoding='utf-8-sig')))
