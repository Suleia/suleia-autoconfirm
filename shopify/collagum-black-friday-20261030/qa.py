import pathlib,json,re,urllib.request,http.cookiejar,hashlib,sys
ROOT=pathlib.Path(__file__).parent
HANDLE='polvo-dental-de-colageno-colla-gum'
VARIANT=57911544578380
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(op,path,data=None,json_result=True):
 headers={'User-Agent':'Suleia-CollaGum-owner-authorized-QA','Accept':'application/json' if json_result else 'text/html'}
 b=None if data is None else json.dumps(data).encode('utf8')
 if b:headers['Content-Type']='application/json'
 with op.open(urllib.request.Request('https://suleia.com'+path,data=b,headers=headers),timeout=45) as r:body=r.read().decode('utf8')
 return json.loads(body) if json_result else body
def selector(html):
 m=re.search(r'<quantity-breaks\b.*?</quantity-breaks>',html,re.S);assert m
 return re.sub(r'\s+',' ',re.sub(r'template--\d+__main','template--MAIN__main',m.group())).strip()
def cart_check():
 op=client();assert request(op,'/cart.js')['item_count']==0;cases=[];updates=[]
 product=request(op,'/products/'+HANDLE+'.js');v=[v for v in product['variants'] if v['id']==VARIANT];assert len(v)==1 and v[0]['price']==2999
 def verify(q,total):
  c=request(op,'/cart.js');assert c['currency']=='EUR' and c['item_count']==q and c['total_price']==total and len(c['items'])==1
  l=c['items'][0];assert l['variant_id']==VARIANT and l['quantity']==q and l['original_price']==2999
  assert c['total_discount']==q*2999-total and not c.get('cart_level_discount_applications')
  assert len(l.get('line_level_discount_allocations',[]))==1
  return {'quantity':q,'totalCents':total,'discountCents':c['total_discount'],'lineAllocations':1}
 try:
  for q,total in [(1,2499),(2,2999),(3,3499)]:
   request(op,'/cart/add.js',{'items':[{'id':VARIANT,'quantity':q}]});cases.append(verify(q,total));l=request(op,'/cart.js')['items'][0];request(op,'/cart/change.js',{'id':l['key'],'quantity':0})
  request(op,'/cart/add.js',{'items':[{'id':VARIANT,'quantity':1}]})
  for q,total in [(2,2999),(3,3499),(2,2999),(1,2499)]:
   l=request(op,'/cart.js')['items'][0];request(op,'/cart/change.js',{'id':l['key'],'quantity':q});updates.append(verify(q,total))
 finally:
  for l in request(op,'/cart.js')['items']:
   assert l['variant_id']==VARIANT;request(op,'/cart/change.js',{'id':l['key'],'quantity':0})
  assert request(op,'/cart.js')['item_count']==0
 return {'cases':cases,'updates':updates,'testCartEmpty':True,'ordersCreated':0,'checkoutSubmitted':False,'operatorCartUsed':False}
def run(phase):
 snapshots={}
 for h in [HANDLE,'crema-nida','crema-seoul-1988']:
  snapshots[h]=selector(request(client(),'/products/'+h,json_result=False))
 if phase=='before':
  (ROOT/'selector-baselines.private.json').write_text(json.dumps(snapshots),encoding='utf8')
 else:
  before=json.loads((ROOT/'selector-baselines.private.json').read_text(encoding='utf8'))
  for h in ['crema-nida','crema-seoul-1988']:assert snapshots[h]==before[h],h
  assert 'cg-bf-heading' in snapshots[HANDLE] and 'MISMA CALIDAD' not in snapshots[HANDLE]
 result={'phase':phase,'cart':cart_check(),'selectors':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in snapshots.items()},'nidaSeoulUnchanged':phase=='after'}
 (ROOT/('qa-'+phase+'.json')).write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
if __name__=='__main__':run(sys.argv[1])
