"""Build a NIDA-only presentation patch from fresh Shopify test-theme files."""
import json,hashlib,difflib
from pathlib import Path
root=Path(__file__).parent
source=root/'source';candidate=root/'candidate'
def write(name,value):
 p=candidate/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value,encoding='utf-8',newline='')
s=(source/'snippets/quantity-breaks.liquid').read_text(encoding='utf-8')
original=s
assert hashlib.md5(s.encode()).hexdigest()=='9c934494d8649150066da3834387acb5','Unexpected shared-selector source: pull and review fresh files before rebuilding'
changes=[]
def insert(anchor,added):
 global s
 assert s.count(anchor)==1,anchor
 s=s.replace(anchor,anchor+added,1);changes.append((anchor,added))
insert('class="quantity-breaks quantity-breaks--{{ block.settings.style }}',"{% if product.handle == 'crema-nida' %} nida-premium-packs{% endif %}")
for i in (1,2,3):
 anchor=f"{{% if product.handle == 'crema-seoul-1988' %}}<div class=\"s88-detail-list\">"
 # Locate the complete existing SEOUL details line for this option, preserve it verbatim.
 lines=[l for l in s.splitlines() if l.startswith(anchor)]
 a=lines[i-1]
 insert(a,f"\n{{% if product.handle == 'crema-nida' %}}{{% render 'nida-premium-ui', part: 'details', pack: {i} %}}{{% endif %}}")
 a=f"{{% if product.handle == 'crema-seoul-1988' and option_{i}_price_difference > 0 %}}<span class=\"s88-saving\">Ahorras {{{{ option_{i}_price_difference | money_without_currency }}}} €</span>{{% endif %}}"
 insert(a,f"\n{{% if product.handle == 'crema-nida' %}}{{% render 'nida-premium-ui', part: 'price-details', pack: {i}, pack_price: option_{i}_price, saving: option_{i}_price_difference %}}{{% endif %}}")
undo=s
for anchor,added in reversed(changes):undo=undo.replace(anchor+added,anchor,1)
assert undo==original,'Shared selector changed outside seven NIDA-guarded insertions'
write('snippets/quantity-breaks.liquid',s)
for name in ('nida-premium.css','nida-premium-ui.liquid'):
 write(('assets/' if name.endswith('.css') else 'snippets/')+name,(root/name).read_text(encoding='utf-8'))
raw=(source/'templates/product.parches_glp.json').read_text(encoding='utf-8')
assert hashlib.md5(raw.encode()).hexdigest()=='19855befa4ed8d8ea3849eb5db28fbeb','Unexpected NIDA-template source: review concurrent changes before rebuilding'
prefix=raw[:raw.index('{')];t=json.loads(raw[len(prefix):]);old=json.loads(raw[len(prefix):]);m=t['sections']['main'];blocks=m['blocks']
for k in ['divider_6qEgeK','text_wpa87r','title','divider_azx9wE','divider_UcUYCn','text_LamkkY','divider_x6MPRx','text_gMN49x','text_b8nrXk','social_proof_widget_p4q4TN']:
 blocks[k]['disabled']=True
blocks['nida_premium_header']={'type':'custom_liquid','settings':{'custom_liquid':"{% render 'nida-premium-ui', part: 'header' %}"}}
m['block_order'].insert(m['block_order'].index('title'),'nida_premium_header')
blocks['custom_liquid_xMa63b']['settings']['custom_liquid']="{% render 'nida-premium-ui', part: 'trust' %}"
q=blocks['04ba004e-2f54-4936-8b1c-8bcadf6573f6']['settings'];before=old['sections']['main']['blocks']['04ba004e-2f54-4936-8b1c-8bcadf6573f6']['settings']
q['headline']='ELIGE TU RUTINA NIDA';q['margin_top']=12;q['margin_bottom']=15
for i,label,sub,badge,name in [(1,'1 UNIDAD','Ideal para empezar tu rutina con NIDA','','nida-pack-1-unidad-blanco.png'),(2,'PACK DE 2','Paga 1, llévate 2','PACK DESTACADO','nida-pack-2-unidades-blanco.png'),(3,'PACK DE 3','Máximo ahorro para tu rutina','MEJOR VALOR','nida-pack-3-unidades-blanco.png')]:
 q[f'option_{i}_label']=label;q[f'option_{i}_benefit']=sub;q[f'option_{i}_caption']='';q[f'option_{i}_badge']=badge
 q[f'option_{i}_image']='shopify://shop_images/'+name
for k,v in before.items():
 if k.endswith(('_quantity','_fixed_amount_off','_percentage_off_text','_price_text','_compare_price','_compare_price_text')) or k in ['preselected','enable_variant_selectors','update_prices','enable_quantity_discounts']:
  assert q[k]==v,(k,v,q[k])
section=(source/'sections/main-product.liquid').read_text(encoding='utf-8')
schema=json.loads(section.split('{% schema %}')[1].split('{% endschema %}')[0])
quantity_schema=next(b for b in schema['blocks'] if b['type']=='quantity_selector')
for setting in quantity_schema['settings']:
 if setting.get('type')=='range' and setting['id'] in q:
  value=q[setting['id']]
  assert setting['min']<=value<=setting['max'] and (value-setting['min'])%setting.get('step',1)==0,setting['id']
# Preserve every non-main section and all runtime bytes outside NIDA additions.
assert {k:v for k,v in t['sections'].items() if k!='main'}=={k:v for k,v in old['sections'].items() if k!='main'}
assert t['order']==old['order']
new=prefix+json.dumps(t,ensure_ascii=False,indent=2)+'\n'
write('templates/product.parches_glp.json',new)
files=[]
for p in sorted(candidate.rglob('*')):
 if p.is_file():
  rel=p.relative_to(candidate).as_posix();data=p.read_bytes();files.append({'filename':rel,'md5':hashlib.md5(data).hexdigest(),'bytes':len(data)})
(root/'candidate-manifest.json').write_text(json.dumps(files,indent=2),encoding='utf-8')
(root/'candidate.diff').write_text('\n'.join(difflib.unified_diff(raw.splitlines(),new.splitlines(),fromfile='before/product.parches_glp.json',tofile='after/product.parches_glp.json')),encoding='utf-8')
print(json.dumps({'files':files,'sharedSelectorNidaOnlyInsertions':len(changes),'commercialSettingsPreserved':True,'otherSectionsPreserved':True},indent=2))
