import pathlib,json,re,zipfile,hashlib,difflib
root=pathlib.Path(__file__).parent;name='snippets/quantity-breaks.liquid'
backup=json.loads((root/'backup-receipt.private.json').read_text());assert backup['archiveVerified']
with zipfile.ZipFile(root/'main-full-backup-381.zip') as z:
 original=z.read(name).decode()
 for n in [name,'templates/product.collagum.json','sections/main-product.liquid']:
  p=root/'before'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(n))
guard="{% if product.handle == 'polvo-dental-de-colageno-colla-gum' %}"
candidate=original
key='class="quantity-breaks quantity-breaks--{{ block.settings.style }}'
assert candidate.count(key)==1;candidate=candidate.replace(key,key+guard+' cg-reference-packs{% endif %}',1)
calendar='<svg class="cg-calendar" viewBox="0 0 24 24" width="28" height="32" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15l3 3 5-5"/></svg>'
spark='<svg class="cg-duration-spark" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m4 9 2-6m4 10 5-5m-2 9 5-1"/></svg>'
arrow='<svg viewBox="0 0 30 20" width="28" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M27 16C14 18 6 13 5 3m0 0L1 8m4-5 6 3"/></svg>'
items=list(re.finditer(r'<div class="cg-duration">.*?</div>',candidate,re.S));assert len(items)==3
for i,match in reversed(list(enumerate(items,1))):
 duration=f'<div class="cg-duration">{calendar}<span class="cg-duration-copy"><span>{i} '+('bote' if i==1 else 'botes')+f' =</span><strong>{i*3} meses</strong><span>de uso</span></span>{spark}</div>'
 if i>1:duration+=f'<span class="cg-pack-callout">{arrow}<span>'+('El doble de duración, mejor precio' if i==2 else 'La opción más completa')+'</span></span>'
 candidate=candidate[:match.start()]+duration+candidate[match.end():]
icons={2:'<svg class="cg-badge-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m12 2 3.1 6.3L22 9.3l-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1L12 2Z"/></svg>',3:'<svg class="cg-badge-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 2h10v3h4v3c0 3-2 5-5 5a6 6 0 0 1-3 2v4h4v3H7v-3h4v-4a6 6 0 0 1-3-2c-3 0-5-2-5-5V5h4V2ZM5 7v1c0 1.6.7 2.5 2.2 2.8A12 12 0 0 1 7 8V7H5Zm12 0v1a12 12 0 0 1-.2 2.8C18.3 10.5 19 9.6 19 8V7h-2Z"/></svg>'}
for i,icon in icons.items():
 pattern=r'(<p class="quantity-break__badge[^>]*data-text="\{\{ block.settings.option_'+str(i)+r'_badge \}\}">)'
 candidate,count=re.subn(pattern,lambda m:m.group(1)+guard+icon+'{% endif %}',candidate);assert count==1
css=(root/'collagum-reference.css.liquid').read_text()
pattern=re.compile(re.escape(guard)+r'\s*<style>.*?</style>\s*\{% endif %\}',re.S);assert len(pattern.findall(candidate))==1
candidate=pattern.sub(lambda m:guard+'\n<style>\n'+css+'</style>\n{% endif %}',candidate)
strip_cg=lambda s:re.sub(re.escape(guard)+r'.*?\{% endif %\}','',s,flags=re.S)
assert strip_cg(candidate)==strip_cg(original),'Non-CollaGum bytes changed'
for pattern in [r'<input\b.*?>',r'<script\b.*?</script>',r'\{% liquid.*?%\}']:
 assert re.findall(pattern,candidate,re.S)==re.findall(pattern,original,re.S)
assert candidate.count('class="cg-duration"')==3 and candidate.count('class="cg-duration-note"')==1 and candidate.count('class="cg-pack-callout"')==2
p=root/'candidate'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(candidate.encode())
(root/'changes.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),candidate.splitlines(True),fromfile='a/'+name,tofile='b/'+name,n=0)),encoding='utf-8')
receipt={'main':198240600396,'files':[name],'beforeNativeMd5':{name:backup['nativeManifest'][name]},'candidateMd5':{name:hashlib.md5(candidate.encode()).hexdigest()},'nonCollagumSnippetBytesIdentical':True,'allInputsScriptsAndPriceCalculationsIdentical':True,'productTemplateUnchanged':True,'months':[3,6,9],'ownerConfirmedMonths':True,'existingPhotosUnchanged':True,'onlyTransparentImagePaddingOutsideViewport':True,'newJavaScript':False,'photoWindows':{'1':[180,16,276,306],'2':[99,16,439,317],'3':[50,4,522,317]},'sourceOpaqueBboxes':{'1':[186,22,450,316],'2':[105,22,532,327],'3':[56,10,566,315]}}
(root/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt,ensure_ascii=False))
