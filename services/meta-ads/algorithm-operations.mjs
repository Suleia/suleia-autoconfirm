import {createHmac} from 'node:crypto';
export function createAlgorithmOperationsReader({pool,hashKey}){
 if(!pool||!hashKey)return null;
 return async(_range,orders)=>{
  const refs=new Map((orders||[]).filter(o=>o.reference).map(o=>[createHmac('sha256',hashKey).update(o.reference).digest('hex'),o.id]));
  const c=await pool.connect();try{await c.query('BEGIN READ ONLY');
   const r=await c.query('SELECT external_order_id_hash,lifecycle_status,created_at_utc,confirmed_at_utc,delivered_at_utc,first_seen_at,observed_at FROM read_models.integration_dropea_orders WHERE market=$1 AND store_id=$2 AND external_order_id_hash=ANY($3::text[])',['ES','16088',[...refs.keys()]]);
   await c.query('COMMIT');return r.rows.map(r=>({sourceId:refs.get(r.external_order_id_hash),state:r.lifecycle_status,createdAt:r.created_at_utc,confirmedAt:r.confirmed_at_utc,deliveredAt:r.delivered_at_utc,firstSeenAt:r.first_seen_at,observedAt:r.observed_at}));
  }catch{await c.query('ROLLBACK');throw Error('OPERATIONS_READ_UNAVAILABLE');}finally{c.release();}
 };
}
