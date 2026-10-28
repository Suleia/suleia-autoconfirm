import pathlib,json,hashlib,datetime,time
from shop_api import gql,manifest,get_files,MAIN
root=pathlib.Path(__file__).parent;name='snippets/quantity-breaks.liquid'
prior=json.loads((root/'deployment-result.json').read_text());built=json.loads((root/'build-receipt.json').read_text())
validation=json.loads((root/'validation.log').read_text().splitlines()[0]);assert validation['success'] and all(r['result'] in ['inform','success'] for r in validation['responses'])
assert built['candidateMd5']['templates/product.collagum.json']==prior['candidateMd5']['templates/product.collagum.json']
role,before=manifest();assert role=='MAIN'
base=json.loads((root/'backup-receipt.private.json').read_text())['nativeManifest'];expected_before=dict(base);expected_before.update(prior['candidateMd5']);assert before==expected_before
old=get_files([name])[0];assert old['checksumMd5']==prior['candidateMd5'][name]
new=(root/'candidate'/name).read_bytes().decode();checksum=hashlib.md5(new.encode()).hexdigest();assert checksum==built['candidateMd5'][name]
assert old['body']['content'].replace("background:#268a70!important;color:#fff!important}","background:#268a70!important;color:#fff!important;opacity:1!important}",1)==new
assert not (root/'badge-write-journal.json').exists(),'Existing journal: reconcile'
(root/'badge-before.private.json').write_text(json.dumps(old,ensure_ascii=False),encoding='utf-8')
journal={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'filename':name,'beforeMd5':old['checksumMd5'],'candidateMd5':checksum,'status':'BEFORE_REQUEST','reason':'Native unselected badge opacity .6 obscured green badge; visual-only opacity1 override'}
save=lambda:(root/'badge-write-journal.json').write_text(json.dumps(journal,indent=2),encoding='utf-8');save()
try:
 r=gql('mutation CollagumBadge($theme:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$theme,files:$files){upsertedThemeFiles{filename}userErrors{field message}}}',{'theme':f'gid://shopify/OnlineStoreTheme/{MAIN}','files':[{'filename':name,'body':{'type':'TEXT','value':new}}]})['themeFilesUpsert']
 if r['userErrors']:raise RuntimeError('UPSERT_NOT_CONFIRMED')
except Exception:journal['status']='REQUEST_EXCEPTION_READBACK_ONLY';save()
for i in range(4):
 if get_files([name])[0]['checksumMd5']==checksum:break
 if i<3:time.sleep(1+i)
else:raise RuntimeError('UNCERTAIN_DO_NOT_REPLAY')
role,after=manifest();wanted=dict(before);wanted[name]=checksum;assert role=='MAIN' and after==wanted
journal['status']='READBACK_VERIFIED';save()
prior.update({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'candidateMd5':built['candidateMd5'],'visualBadgeContrastFollowupVerified':True})
(root/'deployment-result.json').write_text(json.dumps(prior,indent=2),encoding='utf-8')
approval=json.loads((root/'approval.json').read_text());approval['candidateMd5']=built['candidateMd5'];(root/'approval.json').write_text(json.dumps(approval,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'FINAL_BADGE_CONTRAST_READBACK_VERIFIED','candidateMd5':checksum,'onlyAdditionalDifference':'opacity:1 in CollaGum pack3 badge'}))
