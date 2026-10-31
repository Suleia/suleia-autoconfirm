const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(v)?v:null;
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const text=(v,n=300)=>typeof v==='string'?v.replace(/[\r\n\t]+/g,' ').slice(0,n):null;
const official=a=>a?.source_type==='GLS_OFFICIAL_POSTAL_FORM'&&a.source_url==='https://www.gls-spain.es/es/iframe-buscador-codigos-postales-cloned/'||a?.source_type==='GLS_OFFICIAL_TRACKING_VISIBLE'&&/^https:\/\/mygls\.gls-spain\.es\/e\/\d+\/\d{5}\/es$/.test(a.source_url);
const direct=v=>String(v||'').replace(/\D/g,'').replace(/^34(?=\d{9}$)/,'')!=='910806229';
export function normalizeGlsPickupSignal(row){
 const g=row.raw?.glsPickupNotice;
 if(!g||String(g.order_id)!==String(row.order_id)||String(g.issue_id)!==String(row.incidence_id)||!at(g.observed_at)||!at(g.report_at))return null;
 let agency=null;const a=g.agency;
 if(official(a)&&direct(a.phone)&&['VERIFIED_DIRECTORY_ONLY','VERIFIED_TRACKING_ONLY'].includes(a.validation_status)&&/^\d{1,8}$/.test(a.agency_code)&&at(a.validated_at)){
  agency=Object.fromEntries(['agency_code','agency_name','address_line','postal_code','city','province','opening_hours','phone','source_url','source_type','validated_at'].map(k=>[k,text(a[k])]));
 }
 return {state:code(g.state),reason:code(g.reason),lookup_reason:code(g.lookup_reason),mode:['SHADOW','CANARY','LIVE'].includes(g.mode)?g.mode:'OFF',observed_at:at(g.observed_at),report_at:at(g.report_at),sent_at:at(g.sent_at),agency,amount_cents:Number.isSafeInteger(g.amount_cents)?g.amount_cents:null,wamid:typeof g.wamid==='string'&&/^wamid\.[\w.:-]+$/.test(g.wamid)?g.wamid:null,verified:g.verified===true,template_status:code(g.template?.status),template_id:g.template?.id??null,meta_template_id:g.template?.meta_id??null};
}
// Public agency contact details are allowed only in this constrained official
// GLS directory observation. No customer fields, arbitrary JSON or email.
export function publicGlsAgencySafe(a){
 if(!a)return true;
 const allowed=['agency_code','agency_name','address_line','postal_code','city','province','opening_hours','phone','source_url','source_type','validated_at'];
 return Object.keys(a).every(k=>allowed.includes(k))&&official(a)&&direct(a.phone)&&!!at(a.validated_at)&&/^\d{1,8}$/.test(a.agency_code)&&/^\d{5}$/.test(a.postal_code)&&/^\+?[\d ()-]{9,20}$/.test(a.phone)&&Object.values(a).every(v=>typeof v==='string'&&v.length<=300&&!/[\r\n]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(v));
}
