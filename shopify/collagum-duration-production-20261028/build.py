import pathlib,json,re,zipfile,hashlib,difflib
root=pathlib.Path(__file__).parent
names=['snippets/quantity-breaks.liquid','templates/product.collagum.json']
backup=json.loads((root/'backup-receipt.private.json').read_text())
assert backup['archiveVerified'] and backup['mainUnchangedDuringBackup']
with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:
 originals={n:z.read(n).decode('utf-8') for n in names}
 for n in names+['sections/main-product.liquid']:
  p=root/'before'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(n))
original=originals[names[0]];candidate=original
guard="{% if product.handle == 'polvo-dental-de-colageno-colla-gum' %}"
calendar='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/></svg>'
matches=list(re.finditer(r'<div class="cg-detail-list">.*?</div>',candidate))
assert len(matches)==3
for match,months in reversed(list(zip(matches,[2,4,6]))):
 duration=f'<div class="cg-duration">{calendar}<span class="cg-duration-copy"><span>Hasta</span><strong>{months} meses</strong><span>de uso</span></span></div>'
 candidate=candidate[:match.start()]+duration+candidate[match.end():]
head='  <div class="quantity-breaks-container">'
assert candidate.count(head)==1
candidate=candidate.replace(head,guard+'<p class="cg-pack-subtitle">MISMA CALIDAD, MÁS DURACIÓN</p>\n{% endif %}'+head,1)
tail='  <script data-has-variants="{{ has_variants }}" type="application/json">'
assert candidate.count(tail)==1
note='Duración orientativa calculada con un cepillado al día. Puede variar según la cantidad utilizada.'
candidate=candidate.replace(tail,guard+f'<p class="cg-duration-note">{note}</p>\n'+'{% endif %}'+tail,1)
css=(root/'collagum-pack.css.liquid').read_text(encoding='utf-8')
old_css=re.compile(re.escape(guard)+r'\s*<style>.*?</style>\s*\{% endif %\}',re.S)
assert len(old_css.findall(candidate))==1
candidate=old_css.sub(lambda m:guard+'\n<style>\n'+css+'</style>\n{% endif %}',candidate)
strip_cg=lambda s:re.sub(re.escape(guard)+r'.*?\{% endif %\}', '',s,flags=re.S)
assert strip_cg(candidate)==strip_cg(original),'Non-CollaGum bytes changed'
assert re.findall(r'<input\b.*?>',candidate,re.S)==re.findall(r'<input\b.*?>',original,re.S)
assert re.findall(r'<script\b.*?</script>',candidate,re.S)==re.findall(r'<script\b.*?</script>',original,re.S)
assert re.findall(r'\{% liquid.*?%\}',candidate,re.S)==re.findall(r'\{% liquid.*?%\}',original,re.S)
assert candidate.count('class="cg-duration"')==3 and candidate.count('class="cg-duration-note"')==1
source=originals[names[1]];data=json.loads(source[source.index('{'):])
block_id,block=next((k,v) for k,v in data['sections']['main']['blocks'].items() if v['type']=='quantity_selector')
updates={'option_1_badge':'','option_1_benefit':'Ideal para probar','option_2_badge':'RECOMENDADO','option_2_benefit':'Más duración, mejor precio','option_3_benefit':'Tu mejor opción'}
block_match=re.search(r'("'+re.escape(block_id)+r'"\s*:\s*\{\s*"type"\s*:\s*"quantity_selector"\s*,\s*"settings"\s*:\s*\{)(.*?)(\}\s*\})',source,re.S)
assert block_match
settings_text=block_match.group(2)
for k,v in updates.items():
 pattern=r'('+re.escape(json.dumps(k))+r'\s*:\s*)'+re.escape(json.dumps(block['settings'][k],ensure_ascii=False))
 settings_text,count=re.subn(pattern,lambda m:m.group(1)+json.dumps(v,ensure_ascii=False),settings_text)
 assert count==1
template=source[:block_match.start(2)]+settings_text+source[block_match.end(2):]
modified=json.loads(template[template.index('{'):])
expected=json.loads(json.dumps(data));expected['sections']['main']['blocks'][block_id]['settings'].update(updates)
assert expected==modified
assert block['settings']['preselected']=='option_2'
for i in [1,2,3]:assert block['settings'][f'option_{i}_quantity']==i
contents={names[0]:candidate,names[1]:template}
for n,s in contents.items():
 p=root/'candidate'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(s.encode('utf-8'))
(root/'changes.patch').write_text(''.join(''.join(difflib.unified_diff(originals[n].splitlines(True),contents[n].splitlines(True),fromfile='a/'+n,tofile='b/'+n,n=0)) for n in names),encoding='utf-8')
receipt={'main':198240600396,'files':names,'beforeNativeMd5':{n:backup['nativeManifest'][n] for n in names},'candidateMd5':{n:hashlib.md5(s.encode()).hexdigest() for n,s in contents.items()},'nonCollagumSnippetBytesIdentical':True,'allInputsIdentical':True,'allScriptBlocksIdentical':True,'allPriceCalculationBlocksIdentical':True,'templateOnlyCommercialTextChanges':updates,'templateBlock':block_id,'newJavaScript':False,'newImageAssets':False}
(root/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt,ensure_ascii=False))
