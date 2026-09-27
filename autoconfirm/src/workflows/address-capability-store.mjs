import {selectRows,insertRows,updateRows,isSupabaseEnabled} from '../clients/supabase.mjs';
import {ADDRESS_CAPABILITIES} from './address-capability-policy.mjs';
const prefix='address_capability_v1:';
export const addressCapabilityStore={
 async get(stage){if(!isSupabaseEnabled())throw Error('ADDRESS_STATE_UNAVAILABLE');return (await selectRows('app_state',{query:{key:`eq.${prefix}${stage}`},limit:1}))[0]||null;},
 async initialize(stage,value){try{const rows=await insertRows('app_state',{key:prefix+stage,value,updated_at:new Date().toISOString()},{returning:'representation'});return rows[0];}catch(e){if(!/409|23505/.test(String(e.message)))throw e;return this.get(stage);}},
 async cas(stage,row,value){const rows=await updateRows('app_state',{value,updated_at:new Date().toISOString()},{query:{key:`eq.${prefix}${stage}`,updated_at:`eq.${row.updated_at}`,'value->>revision':`eq.${row.value.revision}`},returning:'representation'});return rows[0]||null;},
 async all(){const result={};for(const stage of ADDRESS_CAPABILITIES){const row=await this.get(stage);if(row)result[stage]=row.value;}return result;}
};
