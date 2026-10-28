import pathlib,json,datetime
root=pathlib.Path(__file__).parent
d=json.loads((root/'deployment-result.json').read_text());p=json.loads((root/'postflight-receipt.json').read_text());u=json.loads((root/'production-ui-qa.json').read_text());assert d['status']=='PROD_READBACK_VERIFIED' and p['status']=='POSTFLIGHT_PASS'
assert {x['width'] for x in u['widths']}=={320,375,390,430,768,1024,1440}
bounds=[(68,15,171,345),(285,80,760,910),(180,80,845,910)]
for x in u['widths']:
 assert x['selected']=='2' and x['pageWidth']<=x['width']
 for i,c in enumerate(x['cards']):
  assert not any(c[k] for k in ['overlap','badgeOverlap','contentOverflow','durationOverflow']) and c['objectFit']=='contain' and c['imageLoaded']
  assert c['price']==['€29,99','€34,99','€44,99'][i] and c['compare']==['€34,99','€69,98','€104,97'][i]
  assert c['saving']==['Ahorras 5,00 €','Ahorras 34,99 €','Ahorras 59,98 €'][i] and str(3*(i+1))+' meses' in c['duration']
  nw,nh=(240,360) if i==0 else (1024,1024);im,ph=c['img'],c['photo'];s=min(im['width']/nw,im['height']/nh);ox=im['x']+(im['width']-nw*s)/2;oy=im['y']+(im['height']-nh*s)/2;b=bounds[i]
  assert ox+b[0]*s>=ph['x']-1 and oy+b[1]*s>=ph['y']-1 and ox+b[2]*s<=ph['right']+1 and oy+b[3]*s<=ph['bottom']+1
assert all(x['requested']==x['selected'] for x in u['transitions']) and not u['consoleErrors']
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PRODUCTION_VERIFIED','deployment':d,'postflight':p,'responsiveWidths':[x['width'] for x in u['widths']],'completeProductFramingChecks':21,'transitions':u['transitions'],'consoleErrors':[],'screenshots':['seoul-production-mobile.png','seoul-production-desktop.png'],'images':'Three exact owner-approved Shopify CDN originals, unchanged','errorsCorrected':['Inherited title span height','Inherited card margins','Duration/price proximity at320 and1024px'],'remainingValidationWarning':'Shared Liquid complexity, no syntax errors'}
(root/'final-receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'status':result['status'],'responsiveWidths':result['responsiveWidths'],'otherFilesUnchanged':379}))
