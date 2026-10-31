import {selectRows,insertRows,updateRows,isSupabaseEnabled} from '../clients/supabase.mjs';
import {hash} from './context.mjs';
export const caseKey=(s,prefix='customer_care')=>`${prefix}_case:${s.canonical_order_id}:${s.active_issue_id||'order'}`;
export function createCustomerCareStore({enabled=isSupabaseEnabled,select=selectRows,insert=insertRows,update=updateRows,prefix='customer_care'}={}){
 if(!['customer_care','conversation_v3'].includes(prefix))throw Error('UNSUPPORTED_CASE_NAMESPACE');
 const requireEnabled=()=>{if(!enabled())throw Error('CUSTOMER_CARE_DURABLE_STORE_UNAVAILABLE');};
 return {
  async load(identity){requireEnabled();const rows=await select('app_state',{query:{key:'eq.'+caseKey(identity,prefix),select:'key,value,updated_at'},limit:1,timeoutMs:5000});return rows[0]||null;},
  async listOpen(){requireEnabled();return select('app_state',{query:{key:`like.${prefix}_case:*`,'value->>status':'neq.CLOSED',order:'updated_at.asc',select:'key,value,updated_at'},limit:10,timeoutMs:5000});},
  async save(state,previous=null){
   requireEnabled();const key=caseKey(state,prefix);
   const semantic={...state,updated_at:undefined,timeline:undefined};
   const signature=hash(semantic);
   if(previous?.value?.projection_hash===signature)return previous;
   const value={...state,projection_hash:signature};
   // The private app_state store is already service-role governed. Append first,
   // then CAS the current projection; concurrent observers cannot erase memory.
   try{await insert('app_state',{key:`${prefix}_event:${hash(key)}:${signature}`,value,updated_at:state.updated_at},{timeoutMs:5000});}
   catch(e){if(!/409|23505|duplicate key/i.test(String(e.message)))throw e;}
   const row={key,value,updated_at:state.updated_at};
   if(!previous){
    try{const saved=await insert('app_state',row,{returning:'representation',timeoutMs:5000});if(!Array.isArray(saved)||saved.length!==1)throw Error('CUSTOMER_CARE_SAVE_UNVERIFIED');return saved[0];}
    catch(e){if(/409|23505|duplicate key/i.test(String(e.message)))throw Error('CUSTOMER_CARE_CONCURRENT_UPDATE');throw e;}
   }
   const saved=await update('app_state',row,{query:{key:'eq.'+key,updated_at:'eq.'+previous.updated_at},returning:'representation'});
   if(!Array.isArray(saved)||saved.length!==1)throw Error('CUSTOMER_CARE_CONCURRENT_UPDATE');return saved[0];
  }
 };
}
