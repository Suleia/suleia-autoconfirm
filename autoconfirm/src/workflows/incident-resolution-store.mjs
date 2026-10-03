import {isSupabaseEnabled,selectRows,upsertRows,insertRows} from '../clients/supabase.mjs';
import {resolutionHash} from './incident-intent-v2.mjs';

// Private existing app_state storage; no customer text/address/phone in plans.
// Dedicated namespaced records avoid overwriting the legacy runtime state.
export function createResolutionStore({enabled=isSupabaseEnabled,select=selectRows,upsert=upsertRows,insert=insertRows}={}){
  return {
    async load(){
      if(!enabled())throw Error('RESOLUTION_DURABLE_STORE_UNAVAILABLE');
      const all=[];
      for(let offset=0;;offset+=500){
        const rows=await select('app_state',{query:{select:'key,value',key:'like.incident_e2e_current:*',order:'key.asc',offset,limit:500},limit:500,timeoutMs:5000});
        all.push(...rows.map(r=>r.value));if(rows.length<500)return all;
      }
    },
    async save(twin){
      if(!enabled())throw Error('RESOLUTION_DURABLE_STORE_UNAVAILABLE');
      const id=`${twin.order_id}:${twin.incident_id}`,at=new Date().toISOString();
      // Append immutable observations before updating the current projection.
      const value=structuredClone(twin),signature=resolutionHash({...value,observed_at:undefined});
      try{await insert('app_state',{key:`incident_e2e_event:${id}:${signature}`,value,updated_at:at},{timeoutMs:5000});}
      catch(e){if(!/409|23505|duplicate key/.test(String(e.message)))throw e;}
      const saved=await upsert('app_state',{key:`incident_e2e_current:${id}`,value,updated_at:at},{onConflict:'key',timeoutMs:5000});
      if(saved?.skipped)throw Error('RESOLUTION_SAVE_NOT_PERSISTED');
      return value;
    }
  };
}
