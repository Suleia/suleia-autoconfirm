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
