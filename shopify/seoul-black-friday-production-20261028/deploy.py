import pathlib,json,hashlib,zipfile,argparse,datetime,time,sys
from shop_api import gql,manifest,get_files,MAIN
root=pathlib.Path(__file__).parent
args=argparse.ArgumentParser();args.add_argument('--execute',action='store_true');args.add_argument('--rollback',action='store_true');args=args.parse_args()
build=json.loads((root/'build-receipt.json').read_text());approval=json.loads((root/'approval.json').read_text());backup=json.loads((root/'backup-receipt.private.json').read_text());before=backup['nativeManifest'];names=list(build['files']);wanted={n:build['files'][n]['candidateMd5'] for n in names}
with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:original={n:z.read(n).decode() for n in names}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(n,v):(root/n).write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf8')
def read():return {f['filename']:f for f in get_files(names)}
def put(values):
 r=gql('mutation SeoulVisual($theme:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$theme,files:$files){upsertedThemeFiles{filename}userErrors{field message}}}',{'theme':f'gid://shopify/OnlineStoreTheme/{MAIN}','files':[{'filename':n,'body':{'type':'TEXT','value':v}} for n,v in values.items()]})['themeFilesUpsert']
 if r['userErrors'] or {f['filename'] for f in r['upsertedThemeFiles']}!=set(values):raise RuntimeError('UPSERT_NOT_CONFIRMED')
def verify(checks):
 for i in range(4):
  rows=read()
  if all(rows[n]['checksumMd5']==v for n,v in checks.items()):return rows
  if i<3:time.sleep(i+1)
 raise RuntimeError('UNCERTAIN_READBACK_NO_REPLAY')
def rollback(execute):
 rows=read();assert all(rows[n]['checksumMd5'] in [before[n],wanted[n]] for n in names),'Concurrent change: refuse rollback'
 print(json.dumps({'rollbackPreflight':True,'execute':execute,'onlyFiles':names}),flush=True)
 if execute and any(rows[n]['checksumMd5']!=before[n] for n in names):
  save('rollback-journal.json',{'at':now(),'status':'BEFORE_REQUEST'});put(original);verify({n:before[n] for n in names});save('rollback-journal.json',{'at':now(),'status':'RESTORED_READBACK'})
def run():
 assert all(approval[k] for k in ['ownerAuthorizedProduction','syntaxPass','responsivePass','economicsUnchanged','currentCollagumPreserved','imagesUnmodified'])
 assert approval['candidateMd5']==wanted and set(names)=={'snippets/quantity-breaks.liquid','templates/product.seoul_1988.json'}
 assert hashlib.sha256((root/'main-full-backup-381.zip').read_bytes()).hexdigest()==approval['backupArchiveSha256']
 if args.rollback:return rollback(args.execute)
 role,current=manifest();assert role=='MAIN' and current==before,'Concurrent theme change: rebuild instead of overwriting'
 rows=read();assert all(rows[n]['body']['content']==original[n] for n in names)
 product=gql('query{product(id:"gid://shopify/Product/16138510991692"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product']
 assert product['handle']=='crema-seoul-1988' and product['templateSuffix']=='seoul_1988' and product['variants']['nodes']==[{'id':'gid://shopify/ProductVariant/58939591852364','price':'29.99','compareAtPrice':'34.99'}]
 values={n:(root/'candidate'/n).read_bytes().decode() for n in names};assert all(hashlib.md5(values[n].encode()).hexdigest()==wanted[n] for n in names)
 save('production-preflight.json',{'at':now(),'main':MAIN,'fullManifestMatchesBackup':True,'fileCount':len(current),'candidateMd5':wanted,'productUnchanged':product})
 print(json.dumps({'preflight':'PASS','execute':args.execute,'files':names}),flush=True)
 if not args.execute:return
 assert not (root/'write-journal.json').exists(),'Existing journal: reconcile first'
 journal={'at':now(),'status':'BEFORE_REQUEST','files':names,'candidateMd5':wanted};save('write-journal.json',journal)
 try:
  try:put(values)
  except Exception:journal['status']='REQUEST_EXCEPTION_READBACK_ONLY';save('write-journal.json',journal);verify(wanted)
  verified=verify(wanted);assert all(verified[n]['body']['content']==values[n] for n in names)
  journal['status']='READBACK_VERIFIED';save('write-journal.json',journal)
  role,after=manifest();expected=dict(before);expected.update(wanted);assert role=='MAIN' and after==expected
  assert gql('query{product(id:"gid://shopify/Product/16138510991692"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product']==product
  r={'at':now(),'status':'PROD_READBACK_VERIFIED','main':MAIN,'changedFiles':names,'fileCount':len(after),'otherFilesUnchanged':len(after)-len(names),'candidateMd5':wanted,'productUnchanged':True,'wholeThemePublished':False,'backupArchiveSha256':approval['backupArchiveSha256']};save('deployment-result.json',r);print(json.dumps(r),flush=True)
 except Exception:rollback(True);raise
if __name__=='__main__':
 try:run()
 except Exception as e:print(json.dumps({'status':'STOPPED_RECONCILE','errorType':type(e).__name__,'reason':str(e) if isinstance(e,AssertionError) else 'OPERATION_FAILED_NO_BLIND_RETRY'}));sys.exit(1)
