import {randomUUID} from 'node:crypto';
export class ExecutiveLedger {
 constructor(pool){this.pool=pool;}
 async claim({id,account,day,kind,principal,now}){
  const lease=randomUUID();
  const r=await this.pool.query(`INSERT INTO economics.ads_executive_reports(id,account_id,local_date,kind,state,lease,lease_until,principal)
   VALUES($1,$2,$3,$4,'PREPARING',$5,to_timestamp($6/1000.0)+interval '5 minutes',$7)
   ON CONFLICT(id) DO UPDATE SET state='PREPARING',lease=$5,lease_until=to_timestamp($6/1000.0)+interval '5 minutes',attempts=economics.ads_executive_reports.attempts+1,updated_at=now()
   WHERE economics.ads_executive_reports.state IN ('FAILED','PREPARING') AND economics.ads_executive_reports.lease_until<to_timestamp($6/1000.0) AND economics.ads_executive_reports.attempts<3
   RETURNING id`,[id,account,day,kind,lease,now,principal]);return r.rowCount?lease:null;
 }
 async complete(id,lease,body){return (await this.pool.query("UPDATE economics.ads_executive_reports SET state='READY',body=$3,error_code=NULL,updated_at=now() WHERE id=$1 AND lease=$2 AND state='PREPARING' RETURNING id",[id,lease,body])).rowCount===1;}
 async fail(id,lease){await this.pool.query("UPDATE economics.ads_executive_reports SET state='FAILED',error_code='EXECUTIVE_GENERATION_FAILED',updated_at=now() WHERE id=$1 AND lease=$2 AND state='PREPARING'",[id,lease]);}
 async missed({id,account,day,now}){
  await this.pool.query("UPDATE economics.ads_executive_reports SET state='MISSED',error_code='EXECUTIVE_WINDOW_EXPIRED',updated_at=now() WHERE account_id=$1 AND kind='DAILY' AND state IN ('PREPARING','FAILED') AND (local_date<$2 OR (local_date=$2 AND $3::boolean))",[account,day,true]);
  await this.pool.query("INSERT INTO economics.ads_executive_reports(id,account_id,local_date,kind,state,principal,error_code) VALUES($1,$2,$3,'DAILY','MISSED','scheduler','EXECUTIVE_WINDOW_EXPIRED') ON CONFLICT DO NOTHING",[id,account,day]);
 }
 async expirePrior(account,day){await this.pool.query("UPDATE economics.ads_executive_reports SET state='MISSED',error_code='EXECUTIVE_WINDOW_EXPIRED',updated_at=now() WHERE account_id=$1 AND kind='DAILY' AND local_date<$2 AND state IN ('PREPARING','FAILED')",[account,day]);}
 async get(id,account){return (await this.pool.query('SELECT * FROM economics.ads_executive_reports WHERE id=$1 AND account_id=$2',[id,account])).rows[0]||null;}
 async history(account,{cursor=null,limit=20}={}){
  limit=Number(limit);if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('QUERY_INVALID');
  let a=null;if(cursor){try{a=JSON.parse(Buffer.from(cursor,'base64url'));if(!/^[a-f0-9]{64}$/.test(a.id)||!Number.isFinite(Date.parse(a.at)))throw Error();}catch{throw Error('QUERY_INVALID');}}
  const rows=(await this.pool.query(`SELECT id,local_date,kind,state,error_code,attempts,created_at,updated_at,body->>'observedAt' AS observed_at,body->>'dataState' AS data_state,
   to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS anchor FROM economics.ads_executive_reports
   WHERE account_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text)) ORDER BY created_at DESC,id DESC LIMIT $4`,[account,a?.at||null,a?.id||null,limit+1])).rows;
  const entries=rows.slice(0,limit),last=entries.at(-1);return {entries,nextCursor:rows.length>limit?Buffer.from(JSON.stringify({at:last.anchor,id:last.id})).toString('base64url'):null};
 }
 async deliveries(id){return (await this.pool.query('SELECT recipient,part,state,attempts,message_id,code,created_at,updated_at FROM economics.ads_executive_deliveries WHERE report_id=$1 ORDER BY recipient,part',[id])).rows;}
 async claimPart({id,recipient,part,hash,now}){
  const claim=randomUUID();
  const r=await this.pool.query(`INSERT INTO economics.ads_executive_deliveries(report_id,recipient,part,content_hash,state,claim_id) VALUES($1,$2,$3,$4,'SENDING',$5)
   ON CONFLICT(report_id,recipient,part) DO UPDATE SET state='SENDING',claim_id=$5,attempts=economics.ads_executive_deliveries.attempts+1,updated_at=now()
   WHERE economics.ads_executive_deliveries.state='RETRY' AND economics.ads_executive_deliveries.content_hash=$4 AND economics.ads_executive_deliveries.retry_at<=to_timestamp($6/1000.0) AND economics.ads_executive_deliveries.attempts<3
   RETURNING claim_id`,[id,recipient,part,hash,claim,now]);return r.rowCount?claim:null;
 }
 async finishPart({id,recipient,part,claim,state,messageId=null,retrySeconds=60,code=null}){
  return (await this.pool.query(`UPDATE economics.ads_executive_deliveries SET state=$5,message_id=$6,retry_at=CASE WHEN state='SENDING' THEN now()+make_interval(secs=>$7) ELSE retry_at END,code=$8,updated_at=now()
   WHERE report_id=$1 AND recipient=$2 AND part=$3 AND claim_id=$4 AND (state='SENDING' OR (state=$5 AND message_id IS NOT DISTINCT FROM $6 AND code IS NOT DISTINCT FROM $8)) RETURNING report_id`,[id,recipient,part,claim,state,messageId,retrySeconds,code])).rowCount===1;
 }
}
