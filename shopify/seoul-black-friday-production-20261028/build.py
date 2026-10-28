import pathlib,re,json,hashlib,difflib,zipfile
root=pathlib.Path(__file__).parent
snippet='snippets/quantity-breaks.liquid';template='templates/product.seoul_1988.json'
old=(root/'before'/snippet).read_text(encoding='utf8');new=old
new=new.replace('class="quantity-breaks quantity-breaks--','class="quantity-breaks{% if product.handle == \'crema-seoul-1988\' %} s88-black-friday{% endif %} quantity-breaks--',1)
new=new.replace('<span>{{ block.settings.headline }}</span>',"<span>{% if product.handle == 'crema-seoul-1988' %}<span class=\"s88-offer\">OFERTA</span>BLACK FRIDAY{% else %}{{ block.settings.headline }}{% endif %}</span>",1)
calendar='<svg class="s88-calendar" viewBox="0 0 24 24" width="18" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M7 15h4M7 18h7"/></svg>'
duration=[]
for i in range(1,4):
 d=f'<div class="s88-duration">{calendar}<span class="s88-duration-copy"><span>Hasta {i*3} meses</span><span>de uso</span></span></div>';duration.append(d)
 pattern=r'(<div class="s88-detail-list">).*?</div>'
 new,n=re.subn(pattern,lambda m:d,new,count=1,flags=re.S);assert n==1
 # Keep the approved source image and loading behavior; dimensions match actual files.
 src='seoul-pack-1-transparent-v2.png?v=1793121657' if i==1 else f'seoul-pack-{i}-tight-centered-v3.png?v='+('1793131337' if i==2 else '1793131344')
 w,h=(240,360) if i==1 else (1024,1024)
 line=next(x for x in new.splitlines() if src in x)
 new=new.replace(line,line.replace('width="180" height="125"',f'width="{w}" height="{h}"'))
assert 's88-detail-list' not in new
# No changes to inputs, calculations, scripts or non-SEOUL branch content.
for pattern in [r'<input\b.*?>',r'{% liquid.*?%}',r'<script\b.*?</script>']:
 assert re.findall(pattern,old,re.S)==re.findall(pattern,new,re.S)
def erase_seoul(s):
 s=re.sub(r'{% if product.handle == \'crema-seoul-1988\'[^%]*%}.*?{% endif %}','',s,flags=re.S)
 return s
# The header's else retains its original rendering for all other products.
non=erase_seoul(new).replace('<span></span>BLACK FRIDAY','')
new_raw=(root/'before'/template).read_text(encoding='utf8');text=new_raw
changes={'option_2_benefit':('Doble cantidad, mejor precio','Doble cantidad, más tiempo para tu rutina'),'option_3_benefit':('Máximo ahorro para tu rutina','El mayor ahorro y más tiempo para tu rutina')}
for k,(a,b) in changes.items():
 a=json.dumps(a,ensure_ascii=False);b=json.dumps(b,ensure_ascii=False)
 pattern=r'("'+k+r'":\s*)'+re.escape(a)
 text,n=re.subn(pattern,lambda m:m[1]+b,text,count=1);assert n==1
css_old=re.search(r'<style id="seoul-selector-premium-v1-20261027">.*?</style>',(root/'existing-seoul-style.liquid').read_text(encoding='utf8'),re.S).group()
tablet=css_old[css_old.index('@media (min-width:750px)'):css_old.rindex('</style>')]
css=(root/'seoul-black-friday.css.liquid').read_text(encoding='utf8')
css_new='<style id="seoul-black-friday-selector-20261028">\n'+css+'\n'+tablet+'</style>'
encoded_old=json.dumps(css_old,ensure_ascii=False)[1:-1];encoded_new=json.dumps(css_new,ensure_ascii=False)[1:-1]
assert text.count(encoded_old)==1
text=text.replace(encoded_old,encoded_new)
parse=lambda s:json.loads(re.sub(r'^\s*/\*.*?\*/','',s,flags=re.S))
a,b=parse(new_raw),parse(text)
settings=a['sections']['main']['blocks']['04ba004e-2f54-4936-8b1c-8bcadf6573f6']['settings']
settings2=b['sections']['main']['blocks']['04ba004e-2f54-4936-8b1c-8bcadf6573f6']['settings']
changed=[k for k in settings if settings[k]!=settings2[k]];assert set(changed)==set(changes)
for i,fixed in enumerate(['0.00','24.99','44.98'],1):
 assert settings2[f'option_{i}_quantity']==i and settings2[f'option_{i}_fixed_amount_off']==fixed
assert settings2['preselected']=='option_2'
assert re.findall(r'<script\b.*?</script>',new_raw,re.S)==re.findall(r'<script\b.*?</script>',text,re.S)
outputs={snippet:new,template:text};patch=''
for n,c in outputs.items():
 p=root/'candidate'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(c,encoding='utf8',newline='')
 before=(root/'before'/n).read_text(encoding='utf8')
 patch+=''.join(difflib.unified_diff(before.splitlines(True),c.splitlines(True),fromfile='a/'+n,tofile='b/'+n,n=0))
(root/'changes.patch').write_text(patch,encoding='utf8')
receipt={'theme':198240600396,'files':{n:{'beforeMd5':hashlib.md5((root/'before'/n).read_bytes()).hexdigest(),'candidateMd5':hashlib.md5(c.encode()).hexdigest()} for n,c in outputs.items()},'durations':[3,6,9],'pricesCents':[2999,3499,4499],'compareCents':[3499,6998,10497],'fixedAmountOff':['0.00','24.99','44.98'],'inputCalculationScriptsUnchanged':True,'default':2,'templateSettingsChanged':changed,'imagesUnchanged':True,'fullBackupFiles':381}
(root/'build-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf8')
print(json.dumps(receipt))
