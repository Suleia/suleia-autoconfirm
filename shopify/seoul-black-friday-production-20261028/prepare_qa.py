import pathlib,json,re,zipfile,urllib.request,http.cookiejar,subprocess,base64,os,sys
root=pathlib.Path(__file__).parent
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(op,path,data=None,json_result=True):
 headers={'User-Agent':'Suleia-SEOUL-authorized-QA','Accept':'application/json' if json_result else 'text/html'}
 b=None if data is None else json.dumps(data).encode()
 if b:headers['Content-Type']='application/json'
 with op.open(urllib.request.Request('https://suleia.com'+path,data=b,headers=headers),timeout=45) as r:body=r.read().decode()
 return json.loads(body) if json_result else body
def selector(html):
 m=re.search(r'<quantity-breaks\b.*?</quantity-breaks>',html,re.S);assert m
 return re.sub(r'\s+',' ',re.sub(r'template--\d+__main','template--MAIN__main',m.group())).strip()
def cart_check():
 op=client();assert request(op,'/cart.js')['item_count']==0;cases=[];updates=[]
 def verify(q,total):
  c=request(op,'/cart.js');assert c['currency']=='EUR' and c['item_count']==q and c['total_price']==total and len(c['items'])==1
  l=c['items'][0];assert l['variant_id']==58939591852364 and l['quantity']==q and l['original_price']==2999
  assert c['total_discount']==q*2999-total and not c.get('cart_level_discount_applications')
  assert len(l.get('line_level_discount_allocations',[]))==(0 if q==1 else 1)
  return {'quantity':q,'totalCents':total,'discountCents':c['total_discount'],'lineAllocations':len(l.get('line_level_discount_allocations',[]))}
 try:
  for q,total in [(1,2999),(2,3499),(3,4499)]:
   request(op,'/cart/add.js',{'items':[{'id':58939591852364,'quantity':q}]});cases.append(verify(q,total));l=request(op,'/cart.js')['items'][0];request(op,'/cart/change.js',{'id':l['key'],'quantity':0})
  request(op,'/cart/add.js',{'items':[{'id':58939591852364,'quantity':1}]})
  for q,total in [(2,3499),(3,4499),(1,2999)]:
   l=request(op,'/cart.js')['items'][0];request(op,'/cart/change.js',{'id':l['key'],'quantity':q});updates.append(verify(q,total))
 finally:
  for l in request(op,'/cart.js')['items']:
   assert l['variant_id']==58939591852364;request(op,'/cart/change.js',{'id':l['key'],'quantity':0})
  assert request(op,'/cart.js')['item_count']==0
 return {'cases':cases,'updates':updates,'testCartEmpty':True,'ordersCreated':0,'checkoutSubmitted':False,'operatorCartUsed':False}
def prepare():
 target=root/'validation-theme'
 with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:z.extractall(target)
 for n in ['snippets/quantity-breaks.liquid','templates/product.seoul_1988.json']:(target/n).write_bytes((root/'candidate'/n).read_bytes())
 snapshots={}
 for h in ['crema-seoul-1988','polvo-dental-de-colageno-colla-gum','crema-nida']:
  html=request(client(),'/products/'+h,json_result=False);(root/(h+'-before.html')).write_text(html,encoding='utf8');snapshots[h]=selector(html)
 (root/'selector-baselines.private.json').write_text(json.dumps(snapshots),encoding='utf8')
 print('PUBLIC_BASELINES_SAVED',flush=True)
 prompt=pathlib.Path('C:/Users/samue/.codex/attachments/5bdf7601-de24-46a2-81e8-61a749203528/Texto pegado.txt').read_bytes()
 result=subprocess.run(['C:/Users/samue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe',str(root.parent/'seoul-premium-deploy-20261027/tooling/collagum-validate.mjs'),'--api','liquid','--theme-path',str(target),'--files','snippets/quantity-breaks.liquid,templates/product.seoul_1988.json','--artifact-id','seoul-black-friday-prod-20261028','--revision','2','--user-prompt-base64',base64.b64encode(prompt).decode(),'--client-name','Codex','--json'],env=dict(os.environ,OPT_OUT_INSTRUMENTATION='true'),text=True,encoding='utf8',capture_output=True)
 (root/'validation.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf8');print(result.stdout,flush=True);assert result.returncode==0 and json.loads(result.stdout.splitlines()[0])['success']
 print(json.dumps({'cartPreflight':cart_check()}),flush=True)
if __name__=='__main__':prepare()
