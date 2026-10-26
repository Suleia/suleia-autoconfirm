import {createHash,randomUUID} from 'node:crypto';
const iso=n=>new Date(n).toISOString();
const safe=s=>String(s??'').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,120).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function orderAlertIntent(text){
 const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!/(?:alertas?|avisos?|notificaciones?|avisame|notificame)/.test(t)||!/pedidos?/.test(t))return null;
 if(/desactiva|desactivar|apaga|deten|no (?:quiero|me mandes|enviar)|silencia/.test(t))return 'disable';
 if(/activa|activar|avisame|notificame|envia|manda|quiero/.test(t))return 'enable';
 return 'settings';
}
export function orderAlertText(o){
 const products=(Array.isArray(o.product_display_names)?o.product_display_names:[]).filter(x=>typeof x==='string').slice(0,3).map(safe).join(', ')||'Producto no disponible';
 const amount=o.total_amount===null?null:Number(o.total_amount),currency=/^[A-Z]{3}$/.test(o.currency||'')?o.currency:null;
 const total=Number.isFinite(amount)&&amount>=0&&currency?new Intl.NumberFormat('es-ES',{style:'currency',currency,maximumFractionDigits:2}).format(amount):'N/D';
 const date=Date.parse(o.created_at_utc),at=Number.isFinite(date)?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(new Date(date)):'no disponible';
 return `🛒 <b>Nuevo pedido registrado en Dropea</b>\nPedido: <b>${safe(o.dropea_order_id)}</b> · ${safe(o.market)}\nProducto: ${products}\nImporte: <b>${safe(total)}</b>\nCreado: ${at} · Europe/Madrid\nDetectado en la sincronización; no acredita confirmación ni cobro.`;
}
export class OrderAlerts {
 constructor({readPool,writePool,now=()=>Date.now()}){Object.assign(this,{readPool,writePool,now});}
 async settings(user){
  const r=await this.writePool.query(`SELECT s.enabled,s.enabled_at,
   (SELECT count(*)::int FROM economics.telegram_order_alert_deliveries d WHERE d.recipient=$1 AND (d.state IN ('UNKNOWN','REJECTED') OR (d.state='SENDING' AND d.updated_at<to_timestamp($2/1000.0)-interval '2 minutes'))) AS needs_review
   FROM economics.telegram_order_alert_settings s WHERE s.recipient=$1`,[user,this.now()]);
  const s=r.rows[0]||{enabled:false,needs_review:0};return {...s,text:`Alertas de pedidos ${s.enabled?'activadas':'desactivadas'} para tu chat. ${s.enabled?'Avisaré de los pedidos nuevos creados desde la activación, cuando se sincronicen con Dropea. No enviaré pedidos anteriores.':''}\n${s.needs_review?`Hay ${s.needs_review} avisos sin entrega verificada; no los reenvío para evitar duplicados.\n`:''}Puedes decir «Activa las alertas de pedidos» o «Desactiva las alertas de pedidos».`};
 }
 async command(user,body){
  const op=body.operation||'settings';
  if(!['settings','enable','disable','due','finish'].includes(op))throw Error('QUERY_INVALID');
  if(op==='enable'||op==='disable'){
   await this.writePool.query(`INSERT INTO economics.telegram_order_alert_settings(recipient,enabled,enabled_at,updated_at) VALUES($1,$2,to_timestamp($3/1000.0),to_timestamp($3/1000.0))
    ON CONFLICT(recipient) DO UPDATE SET enabled=EXCLUDED.enabled,enabled_at=CASE WHEN NOT telegram_order_alert_settings.enabled AND EXCLUDED.enabled THEN EXCLUDED.enabled_at ELSE telegram_order_alert_settings.enabled_at END,updated_at=EXCLUDED.updated_at`,[user,op==='enable',this.now()]);
   return this.settings(user);
  }
  if(op==='settings')return this.settings(user);
  if(op==='finish')return this.finish(user,body);
  const settings=await this.settings(user);if(!settings.enabled)return {state:'DISABLED'};
  const now=this.now(),start=new Date(settings.enabled_at).toISOString();
  const rows=await this.readPool.query({text:`SELECT o.market,o.store_id,o.dropea_order_id,o.product_display_names,o.total_amount,o.currency,o.created_at_utc
   FROM read_models.integration_dropea_orders o LEFT JOIN economics.telegram_order_alert_deliveries d
    ON d.recipient=$1 AND d.market=o.market AND d.store_id=o.store_id AND d.dropea_order_id=o.dropea_order_id
   WHERE o.source_system='DROPEA_PUBLIC_API_V2' AND o.created_at_utc >= $2 AND o.created_at_utc <= $3
    AND (d.id IS NULL OR (d.state='RETRY' AND d.retry_at <= $3 AND d.attempts<4))
   ORDER BY o.first_seen_at,o.market,o.store_id,o.dropea_order_id LIMIT 1`,values:[user,start,iso(now)],query_timeout:2500});
  const o=rows.rows[0];if(!o)return {state:'IDLE'};
  const id=createHash('sha256').update(JSON.stringify([user,o.market,o.store_id,o.dropea_order_id])).digest('hex'),claim=randomUUID();
  const claimed=await this.writePool.query(`INSERT INTO economics.telegram_order_alert_deliveries(id,recipient,market,store_id,dropea_order_id,state,claim_id,created_at,updated_at)
   SELECT $1,$2,$3,$4,$5,'SENDING',$6,to_timestamp($7/1000.0),to_timestamp($7/1000.0)
   FROM economics.telegram_order_alert_settings WHERE recipient=$2 AND enabled=true AND enabled_at=$8
   ON CONFLICT(recipient,market,store_id,dropea_order_id) DO UPDATE SET state='SENDING',claim_id=EXCLUDED.claim_id,attempts=telegram_order_alert_deliveries.attempts+1,updated_at=EXCLUDED.updated_at
   WHERE telegram_order_alert_deliveries.state='RETRY' AND telegram_order_alert_deliveries.retry_at<=EXCLUDED.updated_at AND telegram_order_alert_deliveries.attempts<4
   RETURNING id`,[id,user,o.market,o.store_id,o.dropea_order_id,claim,now,start]);
  if(!claimed.rowCount)return {state:'IDLE'};
  return {state:'SEND',id,claim,text:orderAlertText(o)};
 }
 async finish(user,b){
  if(!/^[a-f0-9]{64}$/.test(b.id||'')||!/^[a-f0-9-]{36}$/.test(b.claim||'')||!['SENT','UNKNOWN','RETRY','REJECTED'].includes(b.state)||(b.state==='SENT'&&(!Number.isSafeInteger(b.messageId)||b.messageId<=0)))throw Error('QUERY_INVALID');
  const seconds=Number.isFinite(b.retrySeconds)?Math.max(1,Math.min(1800,b.retrySeconds)):60;
  const r=await this.writePool.query(`UPDATE economics.telegram_order_alert_deliveries SET state=CASE WHEN $4='RETRY' AND attempts>=4 THEN 'REJECTED' ELSE $4 END,message_id=$5,retry_at=to_timestamp($6/1000.0)+$7*interval '1 second',updated_at=to_timestamp($6/1000.0)
   WHERE id=$1 AND recipient=$2 AND claim_id=$3 AND state='SENDING' RETURNING state`,[b.id,user,b.claim,b.state,b.state==='SENT'?b.messageId:null,this.now(),seconds]);
  if(r.rowCount)return {state:r.rows[0].state};
  const old=await this.writePool.query('SELECT state FROM economics.telegram_order_alert_deliveries WHERE id=$1 AND recipient=$2 AND claim_id=$3',[b.id,user,b.claim]);
  if(!old.rowCount)throw Error('QUERY_INVALID');return {state:old.rows[0].state};
 }
}
