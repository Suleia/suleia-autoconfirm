/* Shared navigation; session storage and OAuth remain owned by app.js. */
const SuleiaShell=(()=>{
 const sections=[['orders','Pedidos','M3 4h14v16H3zM6 8h8M6 12h8M6 16h5'],['incidents','Incidencias','M10 2 1 19h18L10 2ZM10 8v5M10 16h.01'],['automation','Automatización','m11 1-8 11h6l-1 8 9-12h-6z'],['finance','Panel de resultados','M3 19V9M8 19V4M13 19v-8M18 19V1'],['analytics','Centro de datos e información','M2 4h16v14H2zM2 9h16M7 4v14M12 4v14'],['ads','Ads Intelligence','M2 17V9M7 17V5M12 17V1M17 17v-6']];
 let onNavigate,onSignOut,mounted=false;
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
 function close(){const aside=document.querySelector('#app>.sidebar'),toggle=document.getElementById('shell-toggle');aside?.removeAttribute('data-open');toggle?.setAttribute('aria-expanded','false');}
 function mount(options={}){
  onNavigate=options.onNavigate||onNavigate;onSignOut=options.onSignOut||onSignOut;if(mounted)return;mounted=true;
  const aside=document.querySelector('#app>.sidebar'),nav=aside.querySelector('nav');nav.id='primary-navigation';nav.replaceChildren();
  for(const[id,label,path]of sections){const b=el('button','nav-item'),ico=el('span','nav-icon'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(svg.namespaceURI,'path');b.type='button';b.dataset.view=id;b.title=label;b.setAttribute('aria-label',label);svg.setAttribute('viewBox','0 0 20 22');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('aria-hidden','true');p.setAttribute('d',path);svg.append(p);ico.append(svg);b.append(ico,el('span','nav-label',label));b.addEventListener('click',()=>{close();onNavigate?.(id);});nav.append(b);}
  const toggle=el('button','shell-toggle','☰');toggle.id='shell-toggle';toggle.type='button';toggle.setAttribute('aria-label','Abrir menú principal');toggle.setAttribute('aria-controls',nav.id);toggle.setAttribute('aria-expanded','false');toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';aside.toggleAttribute('data-open',open);toggle.setAttribute('aria-expanded',String(open));});aside.querySelector('.brand').append(toggle);
  aside.querySelector('#logout-button').addEventListener('click',()=>onSignOut?.());document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});select('orders');
 }
 function select(view){document.querySelectorAll('#primary-navigation .nav-item').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
 return {mount,select,sections:sections.map(([id,label])=>({id,label}))};
})();
