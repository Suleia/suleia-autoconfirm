import {digest} from './policy.mjs';

const ROOT='https://www.cartociudad.es/geocoder/api/geocoder/';
const norm=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[.,]/g,' ').replace(/\s+/g,' ').trim();
const road=s=>norm(s).replace(/^(?:c\/|c |cl |calle )/,'calle ').replace(/^(?:av |avda |avenida )/,'avenida ');
const province=s=>({vizcaya:'bizkaia',alava:'araba',guipuzcoa:'gipuzkoa',gerona:'girona',lerida:'lleida',orense:'ourense','la coruna':'a coruna'}[norm(s)]||norm(s));
const returnedRoad=r=>{
  if(!/^[a-z]?$/i.test(r.extension||''))return '';
  const address=String(r.address||'').split(',')[0].trim();
  const suffix=new RegExp('\\s+'+String(r.portalNumber).replace(/[^0-9]/g,'')+(r.extension||'')+'$','i');
  return road(address.replace(suffix,''));
};

export function portalQuery(a){
  if(a.country!=='ES'||!a.city||!a.province)return null;
  // Do not interpret a floor/flat as a street number, or invent a missing number.
  const m=String(a.street||'').match(/^(.+?)\s+(\d{1,5})([a-z]?)(?=$|[\s,])/i);
  if(!m||!/[a-záéíóúñ]/i.test(m[1]))return null;
  return {road:m[1],number:m[2],extension:m[3]||'',query:[m[1],m[2]+(m[3]||''),a.city,a.province].join(', ')};
}

export function verifiedPortal(rows,a,parsed){
  if(!Array.isArray(rows)||!parsed||rows.length>=50)return null;
  const matches=rows.filter(r=>r.type==='portal'&&r.id&&String(r.countryCode)==='011'&&r.noNumber===false&&
    String(r.portalNumber)===parsed.number&&norm(r.extension)===norm(parsed.extension)&&
    returnedRoad(r)===road(parsed.road)&&
    [r.muni,r.poblacion].some(city=>norm(city)===norm(a.city))&&province(r.province)===province(a.province)&&
    /^\d{5}$/.test(String(r.postalCode||'')));
  // Unique entity, not merely one selected top result; do not limit to one.
  const unique=new Map(matches.map(r=>[String(r.id)+':'+r.portalNumber+':'+(r.extension||''),r]));
  return unique.size===1?[...unique.values()][0]:null;
}

export function cartociudadResolver({request=fetch,now=Date.now}={}){
  return {async findCandidates(address){
    const parsed=portalQuery(address),empty={query:address,candidates:[],confidence:0,verified:false,evidenceId:null};
    if(!parsed)return {...empty,reason:'FULL_PORTAL_REQUIRED'};
    const read=async(endpoint,params)=>{
      const u=new URL(endpoint,ROOT);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);
      const r=await request(u.href,{redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error('OFFICIAL_ADDRESS_SOURCE_UNAVAILABLE');return r.json();
    };
    // Only public address components: never names, phone, email, floor or order id.
    const rows=await read('candidates',{q:parsed.query,limit:'50'});
    const candidate=verifiedPortal(rows,address,parsed);if(!candidate)return empty;
    const result=await read('find',{id:String(candidate.id),type:'portal',portal:parsed.number,q:parsed.query});
    const confirmed=verifiedPortal(Array.isArray(result)?result:[result],address,parsed);
    if(!confirmed||String(confirmed.id)!==String(candidate.id)||confirmed.postalCode!==candidate.postalCode)return empty;
    const receipt={source:'IGN_CNIG_CARTOCIUDAD',policy:'exact-portal-v1',at:new Date(now()).toISOString(),parsed,candidate,confirmed};
    // Deterministic policy score, not an invented provider probability: exact
    // unique portal+road+locality+province+country+CP, independently read twice.
    return {query:address,candidates:[{...address,postalCode:String(confirmed.postalCode)}],confidence:1,verified:true,evidenceId:digest(receipt),receipt};
  }};
}
