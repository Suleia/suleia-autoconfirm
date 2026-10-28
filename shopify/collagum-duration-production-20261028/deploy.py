import argparse,pathlib,json,zipfile,hashlib,datetime,time,sys
from shop_api import gql,manifest,get_files,MAIN
args=argparse.ArgumentParser();args.add_argument('--execute',action='store_true');args.add_argument('--rollback',action='store_true');args=args.parse_args()
root=pathlib.Path(__file__).parent
approval=json.loads((root/'approval.json').read_text());backup=json.loads((root/'backup-receipt.private.json').read_text())
names=['snippets/quantity-breaks.liquid','templates/product.collagum.json'];expected=approval['candidateMd5'];before=backup['nativeManifest']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(n,v):(root/n).write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf-8')
def same(n,a,b):return json.loads(a[a.index('{'):])==json.loads(b[b.index('{'):]) if n.endswith('.json') else a==b
def read(n):return get_files([n])[0]
def put(n,v):
 r=gql('mutation CollagumApprovedFile($theme:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$theme,files:$files){upsertedThemeFiles{filename}userErrors{field message}}}',{'theme':f'gid://shopify/OnlineStoreTheme/{MAIN}','files':[{'filename':n,'body':{'type':'TEXT','value':v}}]})['themeFilesUpsert']
 if r['userErrors'] or not any(x['filename']==n for x in r['upsertedThemeFiles']):raise RuntimeError('UPSERT_NOT_CONFIRMED')
def verify(n,checksum):
 for i in range(4):
  f=read(n)
  if f['checksumMd5']==checksum:return
  if i<3:time.sleep(1+i)
 raise RuntimeError('READBACK_UNCERTAIN_NO_WRITE_RETRY')
with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:originals={n:z.read(n).decode('utf-8') for n in names}
def rollback(execute):
 observed={n:read(n) for n in names}
 assert all(same(n,f['body']['content'],originals[n]) or f['checksumMd5']==expected[n] for n,f in observed.items()),'Unknown concurrent change: refuse rollback'
 print(json.dumps({'rollbackPreflight':True,'execute':execute,'files':names}),flush=True)
 if not execute:return
 journal={'at':now(),'attempts':[]};save('rollback-journal.json',journal)
 for n in reversed(names):
  f=read(n)
  if same(n,f['body']['content'],originals[n]):continue
  assert f['checksumMd5']==expected[n]
  journal['attempts'].append({'filename':n,'status':'BEFORE_REQUEST'});save('rollback-journal.json',journal)
  put(n,originals[n]);assert same(n,read(n)['body']['content'],originals[n])
  journal['attempts'][-1]['status']='RESTORED_READBACK';save('rollback-journal.json',journal)
 save('rollback-result.json',{'at':now(),'restoredOnlyAuthorizedFiles':True})
def run():
 assert approval['explicitOwnerProductionApproval'] and approval['scope']==names
 for flag in ['fullBackupVerified','syntaxPass','responsivePass','imagesNotReduced','cartPass','nonCollagumBytesIdentical','runtimeInputsAndCalculationsUnchanged']:assert approval[flag]
 assert hashlib.sha256((root/'main-full-backup-381.zip').read_bytes()).hexdigest()==approval['backupArchiveSha256']
 if args.rollback:return rollback(args.execute)
 role,current=manifest();assert role=='MAIN' and current==before,'Concurrent theme change: rebuild, never overwrite'
 files={f['filename']:f for f in get_files(names)};assert all(files[n]['body']['content']==originals[n] for n in names)
 product=gql('query {product(id:"gid://shopify/Product/15849234071884"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product']
 assert product['handle']=='polvo-dental-de-colageno-colla-gum' and product['templateSuffix']=='collagum'
 assert len(product['variants']['nodes'])==1 and product['variants']['nodes'][0]['id']=='gid://shopify/ProductVariant/57911544578380' and product['variants']['nodes'][0]['price']=='29.99'
 values={n:(root/'candidate'/n).read_bytes().decode() for n in names};assert all(hashlib.md5(v.encode()).hexdigest()==expected[n] for n,v in values.items())
 save('production-preflight.json',{'at':now(),'mode':'execute' if args.execute else 'read-only','main':MAIN,'files':names,'fullManifestMatchesBackup':True,'backupFiles':len(current),'candidateMd5':expected,'productUnchanged':product})
 print(json.dumps({'preflight':'PASS','execute':args.execute,'main':MAIN,'backupFiles':len(current),'candidateMd5':expected}),flush=True)
 if not args.execute:return
 assert not (root/'write-journal.json').exists(),'Existing journal: reconcile before any further write'
 journal={'at':now(),'main':MAIN,'attempts':[]}
 try:
  for n in names:
   assert read(n)['checksumMd5']==before[n],'Concurrent file edit'
   journal['attempts'].append({'filename':n,'candidateMd5':expected[n],'at':now(),'status':'BEFORE_REQUEST'});save('write-journal.json',journal)
   try:put(n,values[n])
   except Exception:
    journal['attempts'][-1]['status']='REQUEST_EXCEPTION_READBACK_ONLY';save('write-journal.json',journal)
    verify(n,expected[n])
   verify(n,expected[n]);journal['attempts'][-1]['status']='READBACK_VERIFIED';save('write-journal.json',journal)
  role,after=manifest();changed=sorted(n for n in set(before)|set(after) if before.get(n)!=after.get(n))
  assert role=='MAIN' and changed==sorted(names) and set(before)==set(after)
  assert gql('query {product(id:"gid://shopify/Product/15849234071884"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product']==product
  receipt={'at':now(),'status':'PROD_READBACK_VERIFIED','main':MAIN,'changedFiles':changed,'otherExistingFilesUnchanged':len(after)-len(names),'fileCount':len(after),'candidateMd5':expected,'productUnchanged':True,'wholeThemePublished':False,'fullLocalBackupVerified':True,'backupArchiveSha256':approval['backupArchiveSha256']}
  save('deployment-result.json',receipt);print(json.dumps(receipt),flush=True)
 except Exception:
  rollback(True)
  raise
if __name__=='__main__':
 try:run()
 except Exception as e:
  print(json.dumps({'status':'STOPPED_RECONCILE','errorType':type(e).__name__,'reason':str(e) if isinstance(e,AssertionError) else 'OPERATION_FAILED_NO_BLIND_RETRY'}));sys.exit(1)
