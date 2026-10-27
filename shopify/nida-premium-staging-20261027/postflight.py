"""Authorized anonymous read/cart QA. Isolated cookies; no checkout submission or orders."""
import json,re,hashlib,urllib.request,http.cookiejar
from pathlib import Path
root=Path(__file__).parent
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def req(op,path,data=None,as_json=True):
 payload=None if data is None else json.dumps(data).encode()
 headers={'Accept':'application/json' if as_json else 'text/html','User-Agent':'Suleia-authorized-NIDA-staging-QA'}
 if data is not None:headers['Content-Type']='application/json'
 with op.open(urllib.request.Request('https://suleia.com'+path,data=payload,headers=headers),timeout=45) as r:s=r.read().decode()
 return json.loads(s) if as_json else s
def theme_id(html):
 m=re.search(r'Shopify\.theme\s*=\s*(\{[^;]+\})',html)
 assert m,'Missing theme identity';return json.loads(m.group(1))['id']
def selector(html):
 m=re.search(r'<quantity-breaks\b.*?</quantity-breaks>',html,re.S)
 assert m,'Missing native selector'
 s=re.sub(r'template--\d+__main','template--MAIN__main',m.group(0))
 return re.sub(r'\s+',' ',s).strip()
regressions=[]
for handle in ['polvo-dental-de-colageno-colla-gum','crema-seoul-1988']:
 live=req(client(),'/products/'+handle,as_json=False)
 test=req(client(),'/products/'+handle+'?preview_theme_id=209083892044',as_json=False)
 assert theme_id(live)==198240600396 and theme_id(test)==209083892044
 assert 'nida-premium.css' not in test and 'nida-premium-packs' not in test
 a,b=selector(live),selector(test)
 assert a==b,'Other product selector changed: '+handle
 regressions.append({'handle':handle,'liveTheme':theme_id(live),'testTheme':theme_id(test),'selectorIdentical':True,'selectorSha256':hashlib.sha256(a.encode()).hexdigest(),'nidaAssetsAbsent':True})
op=client();html=req(op,'/products/crema-nida?preview_theme_id=209083892044',as_json=False)
assert theme_id(html)==209083892044
assert 'nida-premium-packs' in html and 'nida-premium.css' in html
for name in ['nida-pack-1-unidad-blanco.png','nida-pack-2-unidades-blanco.png','nida-pack-3-unidades-blanco.png']:assert name in selector(html)
assert req(op,'/cart.js')['item_count']==0
cases=[];updates=[]
def verify(qty,expected):
 cart=req(op,'/cart.js');assert cart['item_count']==qty and cart['total_price']==expected
 assert len(cart['items'])==1;line=cart['items'][0]
 assert line['variant_id']==57618953470284 and line['quantity']==qty and line['original_price']==3499
 a=line.get('line_level_discount_allocations',[])
 assert len(a)==1 and len(cart.get('cart_level_discount_applications',[]))==0
 assert cart['total_discount']==3499*qty-expected
 return {'quantity':qty,'baseCents':3499,'originalCents':line['original_line_price'],'discountCents':cart['total_discount'],'totalCents':cart['total_price'],'lineAllocations':len(a),'cartAllocations':0},line['key']
try:
 for q,total in [(1,2999),(2,3499),(3,4499)]:
  req(op,'/cart/add.js',{'items':[{'id':57618953470284,'quantity':q}]})
  case,key=verify(q,total);cases.append(case)
  req(op,'/cart/change.js',{'id':key,'quantity':0});assert req(op,'/cart.js')['item_count']==0
 req(op,'/cart/add.js',{'items':[{'id':57618953470284,'quantity':1}]})
 for q,total in [(1,2999),(2,3499),(3,4499),(2,3499),(1,2999)]:
  line=req(op,'/cart.js')['items'][0]
  req(op,'/cart/change.js',{'id':line['key'],'quantity':q})
  case,key=verify(q,total);updates.append(case)
finally:
 for line in req(op,'/cart.js')['items']:
  assert line['variant_id']==57618953470284
  req(op,'/cart/change.js',{'id':line['key'],'quantity':0})
 assert req(op,'/cart.js')['item_count']==0
receipt={'theme':209083892044,'baselineProductPricePreserved':True,'approvedImagesPresent':True,'cases':cases,'quantityChanges':updates,'regressions':regressions,'testCartEmpty':True,'ordersCreated':0,'operatorCartUsed':False,'checkoutSubmitted':False}
(root/'postflight.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt,ensure_ascii=False))
