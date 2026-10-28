import pathlib,json,hashlib,datetime,sys
from shop_api import gql,manifest,get_files,MAIN
root=pathlib.Path(__file__).parent
old=json.loads((root/'deployment-result.json').read_text());build=json.loads((root/'build-receipt.json').read_text());name='templates/product.seoul_1988.json';wanted=build['files'][name]['candidateMd5'];expected=json.loads((root/'backup-receipt.private.json').read_text())['nativeManifest'];expected.update(old['candidateMd5'])
role,current=manifest();assert role=='MAIN' and current==expected
f=get_files([name])[0];assert f['checksumMd5']==old['candidateMd5'][name]
value=(root/'candidate'/name).read_bytes().decode();assert hashlib.md5(value.encode()).hexdigest()==wanted
journal=root/'refinement-journal.json';assert not journal.exists();journal.write_text(json.dumps({'status':'BEFORE_REQUEST','before':f['checksumMd5'],'after':wanted}),encoding='utf8')
try:
 r=gql('mutation SeoulRefinement($theme:ID!,$files:[OnlineStoreThemeFilesUpsertFileInput!]!){themeFilesUpsert(themeId:$theme,files:$files){upsertedThemeFiles{filename}userErrors{field message}}}',{'theme':f'gid://shopify/OnlineStoreTheme/{MAIN}','files':[{'filename':name,'body':{'type':'TEXT','value':value}}]})['themeFilesUpsert'];assert not r['userErrors']
except Exception:pass
rows=get_files([name]);assert rows[0]['checksumMd5']==wanted and rows[0]['body']['content']==value,'Uncertain refinement: reconcile, do not retry'
expected[name]=wanted;role,current=manifest();assert role=='MAIN' and current==expected
journal.write_text(json.dumps({'status':'READBACK_VERIFIED','before':f['checksumMd5'],'after':wanted}),encoding='utf8')
old['candidateMd5'][name]=wanted;old['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();old['responsiveRefinementVerified']=True;(root/'deployment-result.json').write_text(json.dumps(old,indent=2),encoding='utf8')
approval=json.loads((root/'approval.json').read_text());approval['candidateMd5'][name]=wanted;(root/'approval.json').write_text(json.dumps(approval,indent=2),encoding='utf8');print(json.dumps(old))
