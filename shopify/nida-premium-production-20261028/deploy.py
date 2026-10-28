"""Guarded, journaled four-file NIDA transfer. Never publishes a whole theme."""
import argparse,datetime,hashlib,json,os,pathlib,sys,time
args=argparse.ArgumentParser();args.add_argument('--workspace',required=True);args.add_argument('--state-dir');args.add_argument('--execute',action='store_true');args.add_argument('--rollback',action='store_true');args=args.parse_args()
root=pathlib.Path(args.state_dir or pathlib.Path(__file__).parent).resolve();workspace=pathlib.Path(args.workspace).resolve()
sys.path.insert(0,str(workspace));import shopify_web_tools as api
for envfile in [workspace/'.env',workspace/'autoconfirm/.env']:api.load_env_file(envfile)
shop=os.environ.get('SHOPIFY_DOMAIN') or os.environ.get('SHOPIFY_SHOP');assert shop=='vcnby0-h1.myshopify.com','Unexpected shop'
version=os.environ.get('SHOPIFY_API_VERSION');assert version,'Pinned API version required'
token=api.get_access_token(shop,os.environ['SHOPIFY_CLIENT_ID'],os.environ['SHOPIFY_CLIENT_SECRET'])
MAIN,SOURCE,BACKUP=198240600396,209083892044,209083760972
names=['assets/nida-premium.css','snippets/nida-premium-ui.liquid','snippets/quantity-breaks.liquid','templates/product.parches_glp.json']
expected=json.loads((root/'preflight-approved.json').read_text(encoding='utf-8-sig'))['candidateMd5']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(name,value):(root/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def call(method,path,body=None):return api.shopify_rest(shop,version,token,method,path,body)
def gql(q,variables=None):
 r=call('POST','graphql.json',{'query':q,'variables':variables or {}})
 if r.get('errors'):raise RuntimeError('GRAPHQL_READ_FAILED')
 return r['data']
def theme_files(theme):
 out={};after=None
 for page in range(4):
  t=gql('query($id:ID!,$after:String){theme(id:$id){id role files(first:250,after:$after){nodes{filename checksumMd5}pageInfo{hasNextPage endCursor}}}}',{'id':f'gid://shopify/OnlineStoreTheme/{theme}','after':after})['theme']
  for f in t['files']['nodes']:out[f['filename']]=f['checksumMd5']
  if not t['files']['pageInfo']['hasNextPage']:return t['role'],out
  after=t['files']['pageInfo']['endCursor']
 raise RuntimeError('MANIFEST_INCOMPLETE')
def file_hash(theme,name):
 t=gql('query($id:ID!,$files:[String!]!){theme(id:$id){files(first:1,filenames:$files){nodes{filename checksumMd5}}}}',{'id':f'gid://shopify/OnlineStoreTheme/{theme}','files':[name]})['theme']
 return next((x['checksumMd5'] for x in t['files']['nodes'] if x['filename']==name),None)
def file_value(theme,name):
 t=gql('query($id:ID!,$files:[String!]!){theme(id:$id){files(first:1,filenames:$files){nodes{filename body{... on OnlineStoreThemeFileBodyText{content}}}}}}',{'id':f'gid://shopify/OnlineStoreTheme/{theme}','files':[name]})['theme']
 return next(x['body']['content'] for x in t['files']['nodes'] if x['filename']==name)
def put_value(name,value):
 payload=gql('mutation NidaApprovedFile($themeId:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$themeId,files:$files){upsertedThemeFiles{filename}userErrors{field message}}}',{'themeId':f'gid://shopify/OnlineStoreTheme/{MAIN}','files':[{'filename':name,'body':{'type':'TEXT','value':value}}]})['themeFilesUpsert']
 if payload['userErrors'] or not any(x['filename']==name for x in payload['upsertedThemeFiles']):raise RuntimeError('FILE_UPSERT_NOT_CONFIRMED')
def equivalent(name,a,b):
 if name.endswith('.json'):return json.loads(a[a.index('{'):])==json.loads(b[b.index('{'):])
 return a==b
def product_guard():
 p=gql('query{product(id:"gid://shopify/Product/15726118502732"){id handle templateSuffix variants(first:5){nodes{id price compareAtPrice}}}}')['product']
 assert p['handle']=='crema-nida' and p['templateSuffix']=='parches_glp'
 assert len(p['variants']['nodes'])==1 and p['variants']['nodes'][0]['id']=='gid://shopify/ProductVariant/57618953470284' and p['variants']['nodes'][0]['price']=='34.99'
 return {'id':p['id'],'handle':p['handle'],'templateSuffix':p['templateSuffix'],'basePrice':'34.99'}
def diff(a,b):return sorted(k for k in set(a)|set(b) if a.get(k)!=b.get(k))
def readback(name,wanted):
 for attempt in range(4):
  actual=file_hash(MAIN,name)
  if actual==wanted:return actual
  if attempt<3:time.sleep(1+attempt)
 raise RuntimeError('READBACK_UNCERTAIN_DO_NOT_REPEAT_WRITE')
def run():
 approval=json.loads((root/'preflight-approved.json').read_text(encoding='utf-8-sig'))
 assert approval['syntaxPass'] and approval['responsivePass'] and approval['sourceEqualsFreshMainScopedMerge']
 old=json.loads((root/'manifests-before.json').read_text(encoding='utf-8-sig'));before={x['filename']:x['checksumMd5'] for x in old['files']['main']}
 journal_path=root/'write-journal.json'
 role,current=theme_files(MAIN);assert role=='MAIN'
 backup_role,backup=theme_files(BACKUP);assert backup_role=='UNPUBLISHED' and backup==before
 if args.rollback:
  prior=json.loads((root/'native-before.private.json').read_text(encoding='utf-8'))
  observed={name:file_hash(MAIN,name) for name in names}
  assert all(observed[n] in [before.get(n),expected[n]] for n in names),'Concurrent edit: refuse rollback'
  print(json.dumps({'rollbackDryRun':not args.execute,'recognizedFiles':names,'restoreExistingFilesOnly':True}))
  if args.execute:
   for name in reversed(names):
    if name not in prior['values'] or observed[name]==before.get(name):continue
    assert file_hash(MAIN,name)==expected[name],'Concurrent rollback edit'
    put_value(name,prior['values'][name])
    assert equivalent(name,file_value(MAIN,name),prior['values'][name]),'Rollback content mismatch'
   save('rollback-result.json',{'at':now(),'restoredExistingFiles':True,'newFilesLeftUnreferenced':True})
  return
 assert current==before,'Concurrent production edit'
 source_role,source=theme_files(SOURCE);assert source_role=='UNPUBLISHED' and diff(before,source)==sorted(names)
 assert all(source[n]==expected[n] for n in names)
 product=product_guard()
 values={n:(root/'merge/candidate'/n).read_bytes().decode('utf-8') for n in names}
 assert all(hashlib.md5(v.encode()).hexdigest()==expected[n] for n,v in values.items())
 assert all(file_value(SOURCE,n)==v for n,v in values.items()),'Source value differs from approved candidate'
 originals={n:file_value(MAIN,n) for n in names if n in before}
 assert all(file_value(BACKUP,n)==v for n,v in originals.items())
 save('native-before.private.json',{'at':now(),'main':MAIN,'backup':BACKUP,'apiVersion':version,'values':originals,'manifest':before,'valueMd5':{n:hashlib.md5(v.encode()).hexdigest() for n,v in originals.items()}})
 print(json.dumps({'mode':'execute' if args.execute else 'preflight','main':MAIN,'backup':BACKUP,'backupFiles':len(before),'sourceMatchesApproved':True,'candidateMd5':expected,'product':product}))
 if not args.execute:return
 assert not journal_path.exists(),'Existing journal: reconcile, never blindly repeat'
 cart=json.loads((root/'baseline-cart.json').read_text(encoding='utf-8'))
 assert cart['testCartEmpty'] and [(x['quantity'],x['finalTotalCents']) for x in cart['cases']]==[(1,2999),(2,3499),(3,4499)]
 journal={'at':now(),'main':MAIN,'source':SOURCE,'backup':BACKUP,'attempts':[]}
 for name in names:
  assert file_hash(MAIN,name)==before.get(name),'Concurrent file edit'
  entry={'filename':name,'candidateMd5':expected[name],'at':now(),'status':'BEFORE_REQUEST'};journal['attempts'].append(entry);save('write-journal.json',journal)
  try:
   put_value(name,values[name])
  except Exception:
   entry['status']='REQUEST_EXCEPTION_RECONCILE_NO_RETRY';save('write-journal.json',journal)
   readback(name,expected[name])
  readback(name,expected[name]);entry['status']='READBACK_VERIFIED';entry['verifiedAt']=now();save('write-journal.json',journal)
 role,after=theme_files(MAIN);assert role=='MAIN' and diff(before,after)==sorted(names)
 assert all(after[n]==expected[n] for n in names);assert product_guard()==product
 save('deployment-result.json',{'at':now(),'status':'PROD_READBACK_VERIFIED','main':MAIN,'source':SOURCE,'backup':BACKUP,'fullBackupFreshlyVerified':True,'changedFiles':sorted(names),'otherExistingFilesUnchanged':377,'fileCount':len(after),'candidateMd5':expected,'productUnchanged':True,'wholeThemePublished':False})
 print(json.dumps({'status':'PROD_READBACK_VERIFIED','changedFiles':sorted(names),'otherExistingFilesUnchanged':377,'fileCount':len(after)}))
if __name__=='__main__':
 try:run()
 except Exception as e:
  print(json.dumps({'status':'STOPPED_RECONCILE_BEFORE_RETRY','errorType':type(e).__name__,'reason':str(e) if isinstance(e,AssertionError) else 'OPERATION_FAILED_NO_AUTOMATIC_RETRY'}));sys.exit(1)
