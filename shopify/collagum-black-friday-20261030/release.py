"""Two-file release. Uses the existing private local Shopify helper; no secrets here."""
import argparse,datetime,hashlib,importlib,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('mode',choices=['check','deploy','rollback']);p.add_argument('--work-dir',required=True);args=p.parse_args()
root=pathlib.Path(args.work_dir).resolve();sys.path.insert(0,str(root));api=importlib.import_module('shop_api')
build=json.loads((root/'build-receipt.json').read_text(encoding='utf8'))
backup=json.loads((root/'backup-receipt.private.json').read_text(encoding='utf8'))
assert api.MAIN==build['main']==198240600396
assert backup['archiveVerified'] and hashlib.sha256((root/'main-full-backup-381.zip').read_bytes()).hexdigest()==backup['archiveSha256']
names=['snippets/quantity-breaks.liquid','templates/product.collagum.json'];assert set(names)==set(build['files'])
role,current=api.manifest(api.MAIN);assert role=='MAIN'
expected=dict(backup['nativeManifest'])
if args.mode=='check':
 print(json.dumps({'role':role,'files':len(current),'baselineMatch':current==expected,'changedFromBaseline':[n for n in set(current)|set(expected) if current.get(n)!=expected.get(n)]}));sys.exit(0)
if args.mode=='deploy':
 assert current==expected,'Concurrent change: review fresh baseline before writing'
 journal=root/'production-write-journal.json';assert not journal.exists(),'Reconcile existing journal; never blindly repeat a request'
 source=root/'candidate';target={n:build['files'][n]['candidateMd5'] for n in names}
else:
 source=root/'before';target={n:build['files'][n]['beforeMd5'] for n in names}
 journal=root/'production-rollback-journal.json';assert not journal.exists()
 for n in names:assert current[n] in [target[n],build['files'][n]['candidateMd5']],'Concurrent file change blocks rollback'
files=[]
for n in names:
 content=(source/n).read_bytes().decode('utf8');assert hashlib.md5(content.encode('utf8')).hexdigest()==target[n]
 files.append({'filename':n,'body':{'type':'TEXT','value':content}})
record={'status':'BEFORE_REQUEST','theme':api.MAIN,'mode':args.mode,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'target':target}
journal.write_text(json.dumps(record,indent=2),encoding='utf8')
query='mutation($theme:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$theme,files:$files){userErrors{field message} upsertedThemeFiles{filename checksumMd5}}}'
try:
 result=api.gql(query,{'theme':f'gid://shopify/OnlineStoreTheme/{api.MAIN}','files':files})
 assert not result['themeFilesUpsert']['userErrors'],'Shopify rejected a file'
except Exception:
 record['status']='UNCERTAIN_READBACK_REQUIRED';journal.write_text(json.dumps(record,indent=2),encoding='utf8');raise
role,after=api.manifest(api.MAIN);wanted=dict(current);wanted.update(target)
assert role=='MAIN' and after==wanted,'Postflight mismatch: inspect before any further write'
nodes=api.get_files(names,api.MAIN)
for n in nodes:assert n['body']['content']==(source/n['filename']).read_bytes().decode('utf8')
record.update(status='READBACK_VERIFIED',filesCompared=len(after),changedFiles=[n for n in after if after[n]!=current[n]],unrelatedFilesUnchanged=True)
journal.write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record))
