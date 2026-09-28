import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const baseline=path.resolve(process.argv[2]);
const output=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const read=(p)=>fs.readFileSync(path.join(baseline,p),'utf8');
const json=(p)=>JSON.parse(read(p).replace(/^\s*\/\*[\s\S]*?\*\//,''));
const original=json('templates/product.neriva_nad.json');
const reference=json('templates/product.parches_glp.json');
const schemas={};
for(const name of fs.readdirSync(path.join(baseline,'sections'))){
  const source=read('sections/'+name);
  const match=source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  if(match){try{schemas[name.replace('.liquid','')]=JSON.parse(match[1]);}catch{}}
}
for(const name of ['seoul-design','seoul-ingredients','seoul-step-description']) schemas[name]=JSON.parse(fs.readFileSync(path.join(output,'sections',name+'.liquid'),'utf8').match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
function settings(schema,values={}){
  const fields=schema.filter(s=>s.id);
  for(const [key,value] of Object.entries(values)){
    const field=fields.find(s=>s.id===key);if(!field)throw new Error('Unknown setting '+key);
    if(field.type==='select'&&!field.options.some(o=>o.value===value))throw new Error('Invalid option '+key);
    if(field.type==='range'&&(value<field.min||value>field.max||Math.abs((value-field.min)/field.step-Math.round((value-field.min)/field.step))>.0001))throw new Error('Invalid range '+key+': '+value);
  }
  return {...Object.fromEntries(fields.filter(s=>s.default!==undefined).map(s=>[s.id,s.default])),...values};
}
function section(type,values={},blocks=[]){
  const schema=schemas[type];if(!schema)throw new Error('No schema '+type);
  const s={type,settings:settings(schema.settings||[],values)};
  if(blocks.length){s.blocks={};s.block_order=[];for(const [id,bt,bv] of blocks){const b=schema.blocks?.find(b=>b.type===bt);if(!b)throw new Error('Unknown block '+bt);s.blocks[id]={type:bt,settings:settings(b.settings||[],bv)};s.block_order.push(id);}}
  return s;
}
const cream='#FFFDF9',ivory='#F7F2EA',ink='#291C19',wine='#8C101A',muted='#72645D';
const colors={color_scheme:'custom',custom_colors_background:cream,custom_colors_text:ink};
const asset=(time)=>`shopify://shop_images/ChatGPTImage24sept2026_${time}.png`;
const text=(copy,more={})=>({text_1:copy,text_2:'',text_3:'',icon_1:'',icon_2:'',icon_3:'',text_color:ink,icon_color:wine,mobile_text_size:16,desktop_text_size:16,margin_top:0,margin_bottom:12,...more});
const offers={enable_quantity_discounts:true,headline:'Elige tu ritual',preselected:'option_2',enable_variant_selectors:false,update_prices:true,border_radius:8,border_width:1,style:'normal',option_4_quantity:0,margin_top:18,margin_bottom:18};
for(let n=1;n<=3;n++)Object.assign(offers,{[`option_${n}_quantity`]:n,[`option_${n}_label`]:['1 UNIDAD','2X1','3X1'][n-1],[`option_${n}_badge`]:['','MÁS VENDIDO','MEJOR VALOR'][n-1],[`option_${n}_badge_style`]:'2',[`option_${n}_caption`]:`${n} ${n===1?'unidad':'unidades'} · ${30*n} ml`,[`option_${n}_fixed_amount_off`]:['0','22.01','44.01'][n-1],[`option_${n}_percentage_off_text`]:'0',[`option_${n}_price_text`]:'[price]',[`option_${n}_compare_price`]:'price',[`option_${n}_compare_price_text`]:n===1?'':'[compare_price]'});
const sections={
  seoul_design:section('seoul-design'),
  main:section('main-product',{
    enable_sticky_info:true,media_size:'large',gallery_layout:'thumbnail_slider',desktop_thumbnails_count:4,media_fit:'contain',constrain_to_viewport:true,display_variant_image_first:false,hide_variants:false,image_zoom:'lightbox',desktop_arrows_position:'sides',mobile_arrows_position:'pagination',mobile_pagination:'numeric',mobile_thumbnails_position:'hidden',mobile_scroll_padding_pixels:0,mobile_media_corner_radius:8,mobile_padding_top:12,mobile_padding_bottom:32,desktop_padding_top:32,desktop_padding_bottom:56
  },[
    ['badge','text',text('K-BEAUTY · CONTORNO DE OJOS',{mobile_text_size:11,desktop_text_size:12,text_color:wine,margin_bottom:9})],
    ['title','title',{text_size:'h0',margin_bottom:12}],
    ['subtitle','text',text('Retinal liposomal + soja fermentada para una mirada más lisa, luminosa y cuidada.',{text_color:muted})],
    ['benefits','text',text('Suaviza visualmente líneas finas',{text_2:'Aporta hidratación y confort',text_3:'Favorece una mirada más luminosa y uniforme',icon_1:'check',icon_2:'check',icon_3:'check',icon_scale:100,direction:'vertical',margin_bottom:9})],
    ['quantity_selector','quantity_selector',offers],
    ['buy_buttons','buy_buttons',{enable_custom_color:true,custom_color:wine,show_dynamic_checkout:false,skip_cart:false,display_price:false,uppercase_text:false,margin_top:12,margin_bottom:12}],
    ['trust','icon_with_text',{layout:'horizontal',desktop_icon_size:24,mobile_icon_size:24,desktop_text_size:12,mobile_text_size:12,desktop_spacing:6,mobile_spacing:6,icon_1:'payments',heading_1:'Pago al recibir',icon_2:'local_shipping',heading_2:'Envío 24/48 h',icon_3:'verified_user',heading_3:'Garantía 30 días',margin_top:12,margin_bottom:12}]
  ]),
  ugc: {...section('ugc-video-strip',{...colors,title:'El ritual, en primera persona'}),disabled:true},
  introduction:section('rich-text',{...colors,custom_colors_background:ivory,padding_top:64,padding_bottom:64},[
    ['caption','caption',{caption:'K-SECRET · SEOUL 1988',text_size:'small'}],
    ['heading','heading',{title:'Una mirada que se siente más cuidada',heading_size:'h0',title_highlight_color:wine}],
    ['text','text',{text:'<p>SEOUL 1988 combina retinal liposomal con ingredientes hidratantes, antioxidantes y acondicionadores para mejorar el aspecto del delicado contorno de ojos dentro de una rutina constante.</p>'}]
  ]),
  story:section('image-with-text',{...colors,section_color_scheme:'custom',custom_section_colors_background:cream,image:asset('20_08_04'),desktop_media_width:50,desktop_content_position:'middle',desktop_padding_top:64,desktop_padding_bottom:48,mobile_padding_top:32,mobile_padding_bottom:16},[
    ['caption','caption',{caption:'UN PEQUEÑO GESTO. TU MOMENTO.',text_size:'small'}],
    ['heading','heading',{title:'Cuidado coreano para una zona delicada',heading_size:'h0',title_highlight_color:wine}],
    ['text','text',{text:'<p>Retinal Liposome 4% + Fermented Bean. Una fórmula para acompañar tu ritual de cuidado con hidratación, confort y una apariencia más luminosa.</p><p><strong>30 ml de cuidado para tu mirada.</strong></p>',text_style:'body'}]
  ]),
  benefits:section('icon-bar',{...colors,title:'Todo lo que buscas en tu contorno',title_highlight_color:wine,heading_size:'h0',text:'',columns_desktop:4,columns_mobile:'2',slider_mobile:false,slider_desktop:false,icon_size:'medium',cards_color_scheme:'custom',custom_cards_colors_background:ivory,custom_cards_colors_text:ink,padding_top:48,padding_bottom:64},[
    ['lines','column',{icon:'waves',title:'Líneas finas',text:'<p>Ayuda a suavizar visualmente líneas finas y textura irregular.</p>'}],
    ['firmness','column',{icon:'north',title:'Firmeza',text:'<p>Péptidos, retinal y bakuchiol complementan una rutina enfocada en la apariencia de firmeza.</p>'}],
    ['light','column',{icon:'light_mode',title:'Luminosidad',text:'<p>Niacinamida y antioxidantes ayudan a conseguir una apariencia más uniforme y luminosa.</p>'}],
    ['hydrate','column',{icon:'water_drop',title:'Hidratación',text:'<p>Glicerina y ácido hialurónico ayudan a mantener la zona hidratada y confortable.</p>'}]
  ]),
  why:section('seoul-step-description',{title:'¿Por qué SEOUL 1988?',title_color:ink,title_highlight_color:wine,section_bg:ivory,card_bg:cream,card_border_color:'#E1D5C8',card_border_width:1,card_border_radius:8,card_shadow:false,card_padding:20,card_padding_mobile:16,card_gap:12,max_width:1200,number_color:wine,step_title_color:ink,step_title_highlight:wine,step_text_color:muted,step_text_size:16,step_text_size_mobile:16,padding_top:64,padding_bottom:64},[
    ['retinal','step',{number_text:'01',title:'RETINAL LIPOSOMAL',text:'<p>Tecnología liposomal diseñada para incorporar retinal en una fórmula para el contorno.</p>'}],
    ['peptides','step',{number_text:'02',title:'PÉPTIDOS',text:'<p>Una combinación de péptidos enfocada en mejorar la apariencia de firmeza y textura.</p>'}],
    ['niacinamide','step',{number_text:'03',title:'NIACINAMIDA',text:'<p>Ayuda a aportar luminosidad y un aspecto más uniforme.</p>'}],
    ['bakuchiol','step',{number_text:'04',title:'BAKUCHIOL',text:'<p>Ingrediente muy utilizado en fórmulas cosméticas enfocadas en los signos visibles de la edad.</p>'}],
    ['ferments','step',{number_text:'05',title:'FERMENTOS COREANOS',text:'<p>Soja, arroz y ginseng fermentados completan una fórmula inspirada en el skincare coreano.</p>'}]
  ]),
  gallery:section('image-slider',{...colors,title:'SEOUL 1988, de cerca',title_highlight_color:wine,heading_size:'h0',autoplay:false,slides_desktop:3,slides_mobile:1,desktop_spacing:24,mobile_spacing:16,mobile_side_padding:24,mobile_full_page:false,desktop_border_radius:8,mobile_border_radius:8,mobile_arrows_position:'under',mobile_dots_position:'under',padding_top:64,padding_bottom:48},['19_58_51','20_03_15','20_08_04'].map((t,i)=>['image'+i,'image_slide',{image:asset(t),description:''}])),
  comparison:{...section('comparison-slider',{...colors,title:'Una diferencia que se aprecia en la mirada',title_highlight_color:wine,text:'',before_label:'ANTES',after_label:'DESPUÉS'}),disabled:true},
  ingredients:section('seoul-ingredients',{eyebrow:'LA FÓRMULA · EN DETALLE',heading:'Una fórmula pensada para tu mirada',description:'Retinal liposomal, ingredientes hidratantes y fermentos coreanos en un mismo ritual.',note:'Retinal Liposome 4% es la denominación del complejo liposomal utilizado en la fórmula; no indica una concentración del 4% de retinal puro.'},[
    ['retinal','ingredient',{title:'RETINAL LIPOSOME 4%',description:'El complejo liposomal de retinal al 4% forma parte de una fórmula pensada para cuidar el aspecto del contorno.'}],
    ...['NIACINAMIDA','BAKUCHIOL','PÉPTIDOS','ÁCIDO HIALURÓNICO','VITAMINA E','DERIVADO DE VITAMINA C','SOJA FERMENTADA','ARROZ FERMENTADO','GINSENG FERMENTADO'].map((title,i)=>['ingredient'+i,'ingredient',{title}])
  ]),
  routine:section('timeline-results',{heading:'Tu ritual SEOUL 1988',heading_highlight_color:wine,heading_size:'h0',subheading:'Un momento para ti. Un gesto suave para tu mirada.',image:asset('20_03_15'),background_color:ivory,heading_color:ink,text_color:muted,line_color:'#D7C2AF',badge_background:cream,badge_border:'#D7C2AF',badge_text_color:wine,padding_top:64,padding_bottom:64},[
    ['clean','timeline_item',{badge_text:'01',title:'Limpia',description:'Aplica sobre la piel limpia y seca.'}],
    ['amount','timeline_item',{badge_text:'02',title:'Una pequeña cantidad',description:'Utiliza una pequeña cantidad para ambos contornos.'}],
    ['apply','timeline_item',{badge_text:'03',title:'Aplica con suavidad',description:'Distribuye mediante pequeños toques sin arrastrar la piel.'}],
    ['progress','timeline_item',{badge_text:'04',title:'Introduce el retinal progresivamente',description:'Empieza de forma gradual y aumenta la frecuencia según tolerancia.'}],
    ['protect','timeline_item',{badge_text:'05',title:'Protección durante el día',description:'Complementa tu rutina diurna con protección solar.'}]
  ]),
  trust:section('icon-bar',{...colors,title:'Cuidamos también de tu experiencia',heading_size:'h1',title_highlight_color:wine,columns_desktop:3,columns_mobile:'1',slider_mobile:false,slider_desktop:false,cards_color_scheme:'custom',custom_cards_colors_background:cream,custom_cards_colors_text:ink,icon_size:'medium',padding_top:48,padding_bottom:48},[
    ['payment','column',{icon:'payments',title:'Pago al recibir',text:'<p>Pago contra reembolso disponible.</p>'}],
    ['shipping','column',{icon:'local_shipping',title:'Envío 24/48 h',text:'<p>Entrega en Península.</p>'}],
    ['guarantee','column',{icon:'verified_user',title:'Garantía 30 días',text:'<p>Consulta las condiciones en nuestra política de reembolso.</p>'}]
  ]),
  faq:section('collapsible-content',{...colors,title:'Preguntas frecuentes',caption:'CONOCE TU CONTORNO',title_highlight_color:wine,heading_size:'h0',collapse_icon:'plus',container_color_scheme:'custom',custom_contaner_colors_background:cream,custom_contaner_colors_text:ink,padding_top:48,padding_bottom:64},[
    ['retinal','collapsible_row',{heading:'¿Qué es Retinal Liposome 4%?',icon:'',row_content:'<p>El nombre Retinal Liposome 4% hace referencia al complejo liposomal utilizado en la fórmula. No significa que contenga un 4% de retinal puro.</p>'}],
    ['routine','collapsible_row',{heading:'¿Para qué tipo de rutina está pensado?',icon:'',row_content:'<p>Para rutinas de cuidado del contorno de ojos enfocadas en hidratación, textura, luminosidad y signos visibles de la edad.</p>'}],
    ['apply','collapsible_row',{heading:'¿Cómo se aplica?',icon:'',row_content:'<p>Aplica una pequeña cantidad sobre el contorno limpio y distribuye suavemente hasta su absorción.</p>'}],
    ['daily','collapsible_row',{heading:'¿Puedo usarlo todos los días?',icon:'',row_content:'<p>Al incorporar retinal, conviene introducirlo gradualmente y ajustar la frecuencia según tolerancia.</p>'}],
    ['sun','collapsible_row',{heading:'¿Debo usar protector solar?',icon:'',row_content:'<p>Sí. La protección solar es especialmente importante dentro de cualquier rutina que incorpore derivados de vitamina A.</p>'}],
    ['size','collapsible_row',{heading:'¿Cuánto producto contiene?',icon:'',row_content:'<p>30 ml.</p>'}],
    ['shipping','collapsible_row',{heading:'¿Cuánto tarda el envío?',icon:'',row_content:'<p>24/48 horas en Península.</p>'}],
    ['payment','collapsible_row',{heading:'¿Puedo pagar al recibir?',icon:'',row_content:'<p>Sí, pago contra reembolso disponible.</p>'}]
  ]),
  reviews:{type:'apps',settings:{display_id:false,include_margins:true},blocks:{judgeme:{type:'shopify://apps/judge-me-reviews/blocks/review_widget/61ccd3b1-a9f2-4160-9fe9-4fec8413e5d8',settings:{review_data:'real_data',max_width:1200,show_shop_reviews:false,empty_state:'hide_widget'}}},block_order:['judgeme']}
};
fs.mkdirSync(path.join(output,'templates'),{recursive:true});
fs.writeFileSync(path.join(output,'templates/product.neriva_nad.json'),JSON.stringify({sections,order:Object.keys(sections)},null,2)+'\n');
const references=new Set(Object.values(reference.sections).map(s=>s.type));
const audited=[...references,...['main-product','ugc-video-strip','rich-text','image-with-text','step-description','image-slider','image-banner','comparison-slider','timeline-results','icons-with-content','icon-bar','collapsible-content','reviews_bars_score','apps']];
const deps=new Set(['templates/product.neriva_nad.json','templates/product.parches_glp.json','layout/theme.liquid','config/settings_data.json','snippets/quantity-breaks.liquid','snippets/buy-buttons.liquid','snippets/product-media-gallery.liquid','snippets/product-thumbnail.liquid','assets/main.js','assets/base.css','assets/section-main-product.css']);
function walk(file){if(deps.has(file))return;deps.add(file);}
for(const name of new Set(audited))walk('sections/'+name+'.liquid');
for(const file of deps){if(!fs.existsSync(path.join(baseline,file)))continue;const source=read(file);for(const match of source.matchAll(/render\s+['"]([^'"]+)['"]/g))walk('snippets/'+match[1]+'.liquid');for(const match of source.matchAll(/['"]([^'"]+\.(?:css|js))['"]\s*\|\s*asset_url/g))walk('assets/'+match[1]);}
const audit={date:'2026-09-28',themeId:198240600396,productId:16138510991692,referenceSections:[...references],reused:[...new Set(Object.values(sections).filter(s=>!s.disabled&&!s.type.startsWith('seoul-')).map(s=>s.type))],newSections:['seoul-design','seoul-ingredients','seoul-step-description'],disabledWithoutEvidence:['ugc-video-strip','comparison-slider'],quantityFormula:'unitPriceCents * quantity * (1 - percentage/100) - fixed_amount_off * 100; display only; Shopify automatic discount required',prices:[{quantity:1,base:2900,discount:0,total:2900},{quantity:2,base:5800,discount:2201,total:3599},{quantity:3,base:8700,discount:4401,total:4299}],files:[...deps].filter(p=>fs.existsSync(path.join(baseline,p))).map(p=>({file:p,sha256:crypto.createHash('sha256').update(read(p)).digest('hex')})),removedSections:Object.keys(original.sections)};
fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({sections:Object.keys(sections).length,auditedFiles:audit.files.length,templateBytes:fs.statSync(path.join(output,'templates/product.neriva_nad.json')).size}));
