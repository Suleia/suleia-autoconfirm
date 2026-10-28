import pathlib,json,hashlib,zipfile,argparse,datetime,time,sys
from shop_api import gql,manifest,get_files,MAIN
args=argparse.ArgumentParser();args.add_argument('--execute',action='store_true');args.add_argument('--rollback',action='store_true');args=args.parse_args()
root=pathlib.Path(__file__).parent;name='snippets/quantity-breaks.liquid'
approval=json.loads((root/'approval.json').read_text());backup=json.loads((root/'backup-receipt.private.json').read_text());before=backup['nativeManifest'];wanted=approval['candidateMd5'][name]
with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:original=z.read(name).decode()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(n,v):(root/n).write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf-8')
def read():return get_files([name])[0]
def put(value):
 p=gql('mutation CollagumReference($theme:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$theme,files:$files){upsertedThemeFiles{filename}userErrors{field message}}}',{'theme':f'gid://shopify/OnlineStoreTheme/{MAIN}','files':[{'filename':name,'body':{'type':'TEXT','value':value}}]})['themeFilesUpsert']
 if p['userErrors'] or not any(f['filename']==name for f in p['upsertedThemeFiles']):raise RuntimeError('UPSERT_NOT_CONFIRMED')
def verify(checksum):
 for i in range(4):
  if read()['checksumMd5']==checksum:return
  if i<3:time.sleep(i+1)
 raise RuntimeError('UNCERTAIN_NO_WRITE_REPLAY')
def rollback(execute):
 f=read();assert f['checksumMd5'] in [before[name],wanted],'Concurrent change: refuse rollback'
 print(json.dumps({'rollbackPreflight':True,'execute':execute,'onlyFile':name}),flush=True)
 if execute and f['checksumMd5']!=before[name]:
  save('rollback-journal.json',{'at':now(),'status':'BEFORE_REQUEST'});put(original);verify(before[name]);assert read()['body']['content']==original;save('rollback-journal.json',{'at':now(),'status':'RESTORED_READBACK'})
def run():
 for flag in ['ownerRequestedReferenceDesign','syntaxPass','responsiveComponentPass','photosUnmodifiedAndOpaquePixelsVisible','functionalInputsScriptsPriceCalculationsUnchanged','templateAndOtherProductsUnchanged']:assert approval[flag]
 assert approval['files']==[name] and approval['ownerConfirmedMonths']==[3,6,9]
 assert hashlib.sha256((root/'main-full-backup-381.zip').read_bytes()).hexdigest()==approval['backupArchiveSha256']
 if args.rollback:return rollback(args.execute)
 role,current=manifest();assert role=='MAIN' and current==before,'Concurrent theme change: rebuild, do not overwrite'
 f=read();assert f['body']['content']==original and f['checksumMd5']==before[name]
 value=(root/'candidate'/name).read_bytes().decode();assert hashlib.md5(value.encode()).hexdigest()==wanted
 product=gql('query{product(id:"gid://shopify/Product/15849234071884"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product'];assert product['templateSuffix']=='collagum' and product['handle']=='polvo-dental-de-colageno-colla-gum' and product['variants']['nodes'][0]['price']=='29.99'
 save('production-preflight.json',{'at':now(),'mode':'execute' if args.execute else 'read-only','main':MAIN,'fullManifestMatchesFreshBackup':True,'files':len(current),'candidateMd5':wanted,'productUnchanged':product})
 print(json.dumps({'preflight':'PASS','execute':args.execute,'fullBackupFiles':len(current),'candidateMd5':wanted}),flush=True)
 if not args.execute:return
 assert not (root/'write-journal.json').exists(),'Existing journal: reconcile first'
 journal={'at':now(),'filename':name,'beforeMd5':before[name],'candidateMd5':wanted,'status':'BEFORE_REQUEST'};save('write-journal.json',journal)
 try:
  try:put(value)
  except Exception:journal['status']='REQUEST_EXCEPTION_READBACK_ONLY';save('write-journal.json',journal);verify(wanted)
  verify(wanted);journal['status']='READBACK_VERIFIED';save('write-journal.json',journal)
  role,after=manifest();expected=dict(before);expected[name]=wanted;assert role=='MAIN' and after==expected
  assert gql('query{product(id:"gid://shopify/Product/15849234071884"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product']==product
  result={'at':now(),'status':'PROD_READBACK_VERIFIED','main':MAIN,'changedFiles':[name],'otherExistingFilesUnchanged':len(after)-1,'fileCount':len(after),'candidateMd5':{name:wanted},'productTemplateUnchanged':True,'productUnchanged':True,'wholeThemePublished':False,'fullLocalBackupVerified':True,'backupArchiveSha256':approval['backupArchiveSha256']}
  save('deployment-result.json',result);print(json.dumps(result),flush=True)
 except Exception:rollback(True);raise
if __name__=='__main__':
 try:run()
 except Exception as e:print(json.dumps({'status':'STOPPED_RECONCILE','errorType':type(e).__name__,'reason':str(e) if isinstance(e,AssertionError) else 'OPERATION_FAILED_NO_BLIND_RETRY'}));sys.exit(1)
