import pathlib,json,re,datetime
from shop_api import manifest,gql
from prepare_qa import client,request,selector,cart_check
root=pathlib.Path(__file__).parent
before=json.loads((root/'backup-receipt.private.json').read_text())['nativeManifest'];build=json.loads((root/'build-receipt.json').read_text());expected=dict(before);expected.update({n:v['candidateMd5'] for n,v in build['files'].items()})
role,after=manifest();assert role=='MAIN' and after==expected
old=json.loads((root/'selector-baselines.private.json').read_text());preserved=[]
for h in ['crema-seoul-1988','polvo-dental-de-colageno-colla-gum','crema-nida']:
 html=request(client(),'/products/'+h,json_result=False);assert json.loads(re.search(r'Shopify\.theme\s*=\s*(\{[^;]+\})',html).group(1))['id']==198240600396
 if h!='crema-seoul-1988':assert selector(html)==old[h];preserved.append(h)
 else:
  assert 's88-black-friday' in html and 'seoul-black-friday-selector-20261028' in html
  for value in ['Hasta 3 meses','Hasta 6 meses','Hasta 9 meses','Doble cantidad, más tiempo para tu rutina','El mayor ahorro y más tiempo para tu rutina']:assert value in html
  assert 's88-detail-list' not in selector(html)
  (root/'production-after.html').write_text(html,encoding='utf8')
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'POSTFLIGHT_PASS','nativeCart':cart_check(),'otherFilesUnchanged':379,'otherSelectorsUnchanged':preserved,'publicMain':True}
(root/'postflight-receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result))
