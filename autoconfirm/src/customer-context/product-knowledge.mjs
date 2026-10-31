import {createHash} from 'node:crypto';
import {productKnowledge} from './product-knowledge-data.mjs';
// Exact catalog identities, reviewed source snapshots and bounded validity.
// A name/price mentioned by a customer never selects the product or quantity.
export function verifiedProductKnowledge(order,{now=Date.now(),questions=[],questionTexts=[]}={}){
 const lines=order?.raw?.line_items||order?.lineItems||[];
 if(!lines.length)return null;
 const identities=[...new Set(lines.map(l=>`${l.product_id}:${l.variant_id}`))];
 if(identities.length!==1)return null;
 const found=productKnowledge.find(p=>`${p.productId}:${p.variantId}`===identities[0]);
 if(!found||!Number.isFinite(Date.parse(found.verifiedAt))||now<Date.parse(found.verifiedAt)||now-Date.parse(found.verifiedAt)>7*86400000)return null;
 if(createHash('sha256').update(found.sourceText).digest('hex')!==found.sourceHash)return null;
 const usage=questions.includes('ASKS_USAGE');
 const text=usage?found.usage:found.description;
 if(!text)return null;
  const literal=questionTexts.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const missingTopics=[];
  if(/manana|noche/.test(literal)&&!found.timingVerified)missingTopics.push('PRODUCT_USAGE_TIMING');
  if(/cuantas veces|veces al dia|frecuencia|cada cuanto/.test(literal)&&!found.frequencyVerified)missingTopics.push('PRODUCT_USAGE_FREQUENCY');
  if(/ingredientes|composicion/.test(literal))missingTopics.push('PRODUCT_INGREDIENT_DETAIL');
 return {verified:true,orderId:String(order.orderId),productId:String(found.productId),variantId:String(found.variantId),
  productName:found.name,units:lines.reduce((n,l)=>n+Number(l.quantity||0),0),text,
  source:found.sourceUrl,sourceHash:found.sourceHash,verifiedAt:found.verifiedAt,
  timingVerified:found.timingVerified,frequencyVerified:found.frequencyVerified,missingTopics,complete:missingTopics.length===0};
}
