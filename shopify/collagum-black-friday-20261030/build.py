import pathlib,json,re,zipfile,hashlib,difflib,sys
root=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path(__file__).parent
name='snippets/quantity-breaks.liquid';template='templates/product.collagum.json'
receipt=json.loads((root/'backup-receipt.private.json').read_text())
assert receipt['archiveVerified'] and receipt['main']==198240600396
assert hashlib.sha256((root/'main-full-backup-381.zip').read_bytes()).hexdigest()==receipt['archiveSha256']
with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:
 original=z.read(name).decode();old_template=z.read(template).decode()
 for n in [name,template]:
  p=root/'before'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(n))
old="{% if product.handle == 'crema-seoul-1988' %}<span class=\"s88-offer\">OFERTA</span>BLACK FRIDAY{% else %}{{ block.settings.headline }}{% endif %}"
prefix="{% if product.handle == 'polvo-dental-de-colageno-colla-gum' %}<span class=\"cg-bf-heading\"><span class=\"cg-bf-kicker\">OFERTA</span> <span class=\"cg-bf-main\">BLACK FRIDAY</span></span>{% elsif product.handle == 'crema-seoul-1988' %}"
new=prefix+old.split("%}",1)[1]
assert original.count(old)==1
candidate=original.replace(old,new,1)
subtitle="{% if product.handle == 'polvo-dental-de-colageno-colla-gum' %}<p class=\"cg-pack-subtitle\">MISMA CALIDAD, MÁS DURACIÓN</p>\n{% endif %}"
assert candidate.count(subtitle)==1;candidate=candidate.replace(subtitle,'',1)
css=(root/'heading.css.liquid').read_text()
guard="{% if product.handle == 'polvo-dental-de-colageno-colla-gum' %}"
addition=guard+'\n<style>\n'+css+'</style>\n{% endif %}\n'
candidate+=addition
assert candidate[:-len(addition)].replace(new,old,1).replace('  <div class="quantity-breaks-container">',subtitle+'  <div class="quantity-breaks-container">',1)==original
for pattern in [r'<input\b.*?>',r'<script\b.*?</script>',r'\{% liquid.*?%\}',r'<img\b.*?>',r'class="cg-pack-photo".*?</div>']:
 assert re.findall(pattern,candidate,re.S)==re.findall(pattern,original,re.S)
new_template=old_template.replace('"headline": "ELIGE TU PACK Y AHORRA"','"headline": "OFERTA BLACK FRIDAY"',1)
assert new_template!=old_template
parse=lambda s:json.loads(re.sub(r'/\*[\s\S]*?\*/','',s))
a,b=parse(old_template),parse(new_template)
blocks=[block for section in b['sections'].values() for block in section.get('blocks',{}).values() if block['type']=='quantity_selector']
assert len(blocks)==1 and blocks[0]['settings']['headline']=='OFERTA BLACK FRIDAY'
blocks[0]['settings']['headline']='ELIGE TU PACK Y AHORRA';assert a==b
changes={name:(original,candidate),template:(old_template,new_template)};patch='';files={}
for n,(before,after) in changes.items():
 p=root/'candidate'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(after.encode())
 patch+=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+n,tofile='b/'+n))
 files[n]={'beforeMd5':receipt['nativeManifest'][n],'candidateMd5':hashlib.md5(after.encode()).hexdigest()}
(root/'changes.patch').write_text(patch,encoding='utf8')
result={'main':198240600396,'files':files,'nonCollagumBytesPreserved':True,'inputsScriptsPricesImagesIdentical':True,'templateOnlyHeadlineChanged':True,'noNewJavaScript':True,'existingPack2Default':True,'pricesEur':[24.99,29.99,34.99],'months':[3,6,9],'backupArchiveSha256':receipt['archiveSha256']}
(root/'build-receipt.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
