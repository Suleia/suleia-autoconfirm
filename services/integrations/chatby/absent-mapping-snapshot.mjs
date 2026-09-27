import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nodeKey=n=>[n.workflow,n.subflow,n.node].join(':');
function normalized(snapshot){
  if(snapshot?.complete!==true || !Array.isArray(snapshot.nodes) || !snapshot.nodes.length
    || !Array.isArray(snapshot.relevant_workflows) || !snapshot.relevant_workflows.length)throw new Error('FULL_GRAPH_SNAPSHOT_REQUIRED');
  const nodes=new Map();
  for(const n of snapshot.nodes){
    if(!n.workflow || !n.subflow || !n.node || !Array.isArray(n.elements) || !Array.isArray(n.destination_edges)
      || nodes.has(nodeKey(n)))throw new Error('INCOMPLETE_OR_DUPLICATE_GRAPH_NODE');
    for(const e of n.elements){
      if(!e.element || e.template_id && (!e.template_name || !e.locale))throw new Error('INCOMPLETE_TEMPLATE_MAPPING');
    }
    nodes.set(nodeKey(n),{workflow:n.workflow,subflow:n.subflow,node:n.node,
      elements:[...n.elements].sort((a,b)=>String(a.element).localeCompare(String(b.element))),
      destination_edges:[...n.destination_edges].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  }
  if(snapshot.relevant_workflows.some(w=>!snapshot.nodes.some(n=>n.workflow===w)))throw new Error('RELEVANT_WORKFLOW_MISSING');
  return nodes;
}
// Evidence must name technical nodes explicitly. Allowing a whole shared
// Incidencias subflow would conceal changes to rejection/address workflows.
export function compareAbsentGraphSnapshots(before,after,authorizedNodeKeys){
  const a=normalized(before),b=normalized(after),allowed=new Set(authorizedNodeKeys);
  if(JSON.stringify([...before.relevant_workflows].sort())!==JSON.stringify([...after.relevant_workflows].sort()))
    return {pass:false,reason:'WORKFLOW_COVERAGE_CHANGED'};
  const changes=[...new Set([...a.keys(),...b.keys()])].filter(k=>hash(a.get(k) || null)!==hash(b.get(k) || null));
  const unrelated=changes.filter(k=>!allowed.has(k));
  return {pass:unrelated.length===0,changes,unrelated,before_hash:hash([...a].sort()),after_hash:hash([...b].sort())};
}

// Chatby does not expose an official complete graph export. This alternative
// records the narrower evidence actually available; it never labels it one.
export function verifyAbsentReproducibleRestore({before,after,authorizedNodeKeys,restore}){
  const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
  const valid=s=>s?.mode==='REPRODUCIBLE_RESTORE' && s.bot==='f295175'
    && hex(s.api_snapshot_hash) && hex(s.screenshot_hash)
    && Array.isArray(s.templates) && s.templates.length===23
    && Array.isArray(s.subflows) && s.subflows.length>0
    && Array.isArray(s.nodes) && s.nodes.length>0
    && hex(s.unrelated_visible_configuration_hash);
  if(!valid(before)||!valid(after))return {pass:false,reason:'RESTORE_EVIDENCE_INCOMPLETE'};
  if(!restore?.procedure || !restore.previous_template || !restore.previous_destinations
    || restore.draft_restore_verified!==true || !hex(restore.verification_hash))
    return {pass:false,reason:'RESTORE_NOT_VERIFIED'};
  const stable=items=>[...items].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(hash(stable(before.templates))!==hash(stable(after.templates))
    || hash(stable(before.subflows))!==hash(stable(after.subflows))
    || before.unrelated_visible_configuration_hash!==after.unrelated_visible_configuration_hash)
    return {pass:false,reason:'UNRELATED_CONFIGURATION_CHANGED'};
  const adapt=s=>({complete:true,nodes:s.nodes,relevant_workflows:[...new Set(s.nodes.map(n=>n.workflow))]});
  const comparison=compareAbsentGraphSnapshots(adapt(before),adapt(after),authorizedNodeKeys);
  return {...comparison,mode:'REPRODUCIBLE_RESTORE',official_full_graph_export:false};
}
