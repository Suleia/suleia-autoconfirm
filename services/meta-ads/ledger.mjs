import { createHash } from 'node:crypto';
import {businessDayBounds} from '../../packages/platform-core/src/business-day.mjs';
export class AdsLedger {
  constructor(pool){this.pool=pool;}
  async executiveBudgetCounts(account,at){
    const day=businessDayBounds({now:new Date(at)});
    const result=await this.pool.query(`SELECT
      (SELECT count(DISTINCT(e.proposal_id,e.campaign_id))::int FROM economics.ads_events e JOIN economics.ads_proposals p ON p.id=e.proposal_id
       WHERE p.body->>'accountId'=$1 AND e.at>=$2 AND e.at<$3 AND e.body->>'state'='VERIFIED' AND e.body->>'externalWrites'='1') AS verified,
      (SELECT count(*)::int FROM economics.ads_proposals p WHERE p.body->>'accountId'=$1 AND p.state='PENDING' AND p.expires_at>to_timestamp($4/1000.0)) AS pending`,[account,day.utc_start,day.utc_end_exclusive,at]);
    return {verifiedChanges:result.rows[0].verified,pendingApprovals:result.rows[0].pending};
  }
  async appendReviewRecord({kind,reference,record,principal,evidenceDigest,observedAt}){
    const eventType=kind.startsWith('EXPERIMENT')?'EXPERIMENT_DESIGN':kind==='DECISION'?'RECOMMENDATION':'OBSERVATION';
    const body={version:'suleia-review-v6.0',kind,reference,record,principal,evidenceDigest,observedAt,externalWrites:0};
    const id=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const insert=c=>c.query('INSERT INTO economics.ads_algorithm_journal(id,event_type,reference,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,eventType,reference.slice(0,100),body]);
    if(kind==='ALERT_OBSERVATION'){
      const c=await this.pool.connect();try{
        await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ads-review-alert:'+reference]);
        const last=(await c.query("SELECT created_at FROM economics.ads_algorithm_journal WHERE body->>'version'='suleia-review-v6.0' AND body->>'kind'='ALERT_OBSERVATION' AND body->'record'->>'key'=$1 ORDER BY created_at DESC LIMIT 1",[reference])).rows[0];
        if(last&&Date.now()-Date.parse(last.created_at)<record.cooldownMs)throw Error('ALERT_COOLDOWN_OR_MISSING');
        await insert(c);await c.query('COMMIT');
      }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
    }else await insert(this.pool);
    return {id,...body,execution:'REVIEW_ONLY'};
  }
  async reviewById(id){if(!/^[a-f0-9]{64}$/.test(id||''))throw Error('QUERY_INVALID');return (await this.pool.query("SELECT id,event_type,reference,body,created_at FROM economics.ads_algorithm_journal WHERE id=$1 AND body->>'version'='suleia-review-v6.0'",[id])).rows[0]||null;}
  async reviewHistory({cursor=null,limit=25}={}){
    if(!Number.isInteger(Number(limit))||limit<1||limit>50)throw Error('QUERY_INVALID');
    let a=null;if(cursor){try{a=JSON.parse(Buffer.from(cursor,'base64url'));if(!/^[a-f0-9]{64}$/.test(a.id)||!Number.isFinite(Date.parse(a.at)))throw Error();}catch{throw Error('QUERY_INVALID');}}
    const rows=(await this.pool.query(`SELECT id,event_type,reference,body,created_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS anchor_at FROM economics.ads_algorithm_journal
      WHERE body->>'version'='suleia-review-v6.0' AND ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::text)) ORDER BY created_at DESC,id DESC LIMIT $3`,[a?.at||null,a?.id||null,Number(limit)+1])).rows;
    const page=rows.slice(0,Number(limit)),last=page.at(-1);return {entries:page,nextCursor:rows.length>limit?Buffer.from(JSON.stringify({at:last.anchor_at,id:last.id})).toString('base64url'):null};
  }
  async liveActivation(account,reference){
    if(!/^[\w:./-]{3,160}$/.test(reference||''))throw Error('LIVE_APPROVAL_REFERENCE_INVALID');
    const rows=(await this.pool.query("SELECT o.state,o.body FROM economics.ads_operations o JOIN economics.ads_proposals p ON p.id=o.proposal_id WHERE o.account_id=$1 AND p.body->>'authorizationReference'=$2 AND p.body->>'mode'='LIVE' AND o.state IN ('VERIFIED','FAILED','UNKNOWN','EXECUTING','RECONCILED')",[account,reference])).rows;
    return {stage:rows.some(r=>['FAILED','UNKNOWN','EXECUTING','RECONCILED'].includes(r.state))?'REVIEW_REQUIRED':rows.some(r=>r.state==='VERIFIED'&&r.body?.externalWrites===1&&r.body?.response?.success===true)?'CANARY_VERIFIED':'CANARY_PENDING'};
  }
  async claimAutopilotSlot(account,slot,at){return (await this.pool.query("INSERT INTO economics.ads_autopilot_slots(account_id,slot_key,state,body,created_at) VALUES($1,$2,'EXECUTING',$3,to_timestamp($4/1000.0)) ON CONFLICT DO NOTHING RETURNING slot_key",[account,slot.key,{slot,externalWrites:0},at])).rowCount===1;}
  async autopilotBaseline(account,date){
    const row=(await this.pool.query("SELECT body FROM economics.ads_autopilot_slots WHERE account_id=$1 AND slot_key=$2 AND state='COMPLETE' AND body->>'version'='SULEIA_META_AUTOPILOT_V6'",[account,date+':08:00'])).rows[0];
    return row?.body?.baseline||null;
  }
  async nightReservations(account,date){return (await this.pool.query("SELECT campaign_id,state,body FROM economics.ads_operations WHERE account_id=$1 AND body->>'operationKind'='NIGHT_22_30' AND body->>'nightBusinessDate'=$2",[account,date])).rows;}
  async minimumReceipts(account,at){return (await this.pool.query("SELECT DISTINCT ON(body->>'campaignId') body FROM economics.ads_algorithm_journal WHERE event_type='OBSERVATION' AND body->>'kind'='BUDGET_MINIMUM_RECEIPT' AND body->>'accountId'=$1 AND (body->>'validUntil')::timestamptz>to_timestamp($2/1000.0) ORDER BY body->>'campaignId',created_at DESC",[account,at])).rows.map(r=>r.body);}
  async saveMinimumReceipt(receipt){const body={...receipt,kind:'BUDGET_MINIMUM_RECEIPT'},id=createHash('sha256').update(JSON.stringify(body)).digest('hex');await this.pool.query("INSERT INTO economics.ads_algorithm_journal(id,event_type,reference,body) VALUES($1,'OBSERVATION',$2,$3) ON CONFLICT DO NOTHING",[id,'budget-minimum:'+receipt.campaignId,body]);}
  async finishAutopilotSlot(account,key,state,body){await this.pool.query("UPDATE economics.ads_autopilot_slots SET state=$3,body=$4,completed_at=now() WHERE account_id=$1 AND slot_key=$2 AND state='EXECUTING'",[account,key,state,body]);}
  async autopilotSlots(account,now){const start=new Date(Date.parse(businessDayBounds({now:new Date(now)}).utc_start)-10*60000).toISOString();return (await this.pool.query('SELECT slot_key,state,body,created_at,completed_at FROM economics.ads_autopilot_slots WHERE account_id=$1 AND created_at>=$2 ORDER BY created_at DESC LIMIT 50',[account,start])).rows;}
  async autopilotHistory(account,now,lookbackMs=86400000){
    if(!Number.isSafeInteger(lookbackMs)||lookbackMs<86400000||lookbackMs>72*3600000)throw Error('AUTOPILOT_HISTORY_RANGE_INVALID');
    const start=Math.min(Date.parse(businessDayBounds({now:new Date(now)}).utc_start),now-lookbackMs);
    const rows=(await this.pool.query(`SELECT p.body,p.state,coalesce(jsonb_agg(jsonb_build_object('campaignId',o.campaign_id,'result',o.body||jsonb_build_object('state',o.state))) FILTER(WHERE o.campaign_id IS NOT NULL),'[]'::jsonb) AS operations
      FROM economics.ads_proposals p LEFT JOIN economics.ads_operations o ON o.proposal_id=p.id
      WHERE p.body->>'accountId'=$1 AND p.created_at>=to_timestamp($2/1000.0) GROUP BY p.id ORDER BY p.created_at DESC LIMIT 301`,[account,start])).rows;
    if(rows.length>300)throw Error('AUTOPILOT_HISTORY_INCOMPLETE');
    return rows.map(r=>({...r.body,state:r.state,items:r.body.items.map(i=>({...i,result:r.operations.find(o=>o.campaignId===i.campaignId)?.result||null}))}));
  }
  async autopilotAudit(account,{campaignId=null,cursor=null,limit=25}={}){
    if(campaignId&&!/^\d+$/.test(campaignId))throw Error('QUERY_INVALID');
    if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('QUERY_INVALID');
    let anchor=null;
    if(cursor){try{if(cursor.length>512)throw Error();anchor=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!/^[a-f0-9]{16}$/.test(anchor.id)||typeof anchor.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(anchor.at)||!Number.isFinite(Date.parse(anchor.at)))throw Error();}catch{throw Error('QUERY_INVALID');}}
    const rows=(await this.pool.query(`SELECT p.id,p.body,p.state,p.created_at,to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
      coalesce(jsonb_agg(jsonb_build_object('campaignId',o.campaign_id,'result',o.body||jsonb_build_object('state',o.state))) FILTER(WHERE o.campaign_id IS NOT NULL),'[]'::jsonb) AS operations
      FROM economics.ads_proposals p LEFT JOIN economics.ads_operations o ON o.proposal_id=p.id
      WHERE p.body->>'accountId'=$1 AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.body->'items') i WHERE i->>'campaignId'=$2))
      AND ($3::timestamptz IS NULL OR p.created_at<$3::timestamptz OR(p.created_at=$3::timestamptz AND p.id<$4))
      GROUP BY p.id ORDER BY p.created_at DESC,p.id DESC LIMIT $5`,[account,campaignId,anchor?.at||null,anchor?.id||null,limit+1])).rows;
    const page=rows.slice(0,limit),last=page.at(-1);
    return {entries:page.map(r=>({id:r.id,state:r.state,createdAt:r.created_at,origin:r.body.origin||'MANUAL',mode:r.body.mode,actor:r.body.actor?.user,
      items:r.body.items.filter(i=>!campaignId||i.campaignId===campaignId).map(i=>({campaignId:i.campaignId,name:i.name,before:i.before,after:i.after,reasons:i.reasons,metric:i.metric,result:r.operations.find(o=>o.campaignId===i.campaignId)?.result||null}))})),nextCursor:rows.length>limit?Buffer.from(JSON.stringify({at:last.cursor_at,id:last.id})).toString('base64url'):null};
  }
  async withAccountBudgetLock(account,fn){
    const c=await this.pool.connect();let locked=false;
    try{locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['ads-account-budget:'+account])).rows[0].locked;if(!locked)throw Error('ACCOUNT_BUDGET_BUSY');return await fn();}
    finally{let failure;try{if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['ads-account-budget:'+account]);}catch(error){failure=error;throw error;}finally{c.release(failure);}}
  }
  async budgetUsage(account,now,cooldownMs=86400000){
    const day=Date.parse(businessDayBounds({now:new Date(now)}).utc_start),since=Math.min(day,now-cooldownMs);
    const rows=(await this.pool.query(`SELECT o.campaign_id,o.updated_at,o.state,i->>'before' AS before,i->>'after' AS after
      FROM economics.ads_operations o JOIN economics.ads_proposals p ON p.id=o.proposal_id
      CROSS JOIN LATERAL jsonb_array_elements(p.body->'items') i
      WHERE o.account_id=$1 AND i->>'campaignId'=o.campaign_id
      AND o.state IN ('EXECUTING','UNKNOWN','VERIFIED','RECONCILED') AND (o.updated_at>=to_timestamp($2/1000.0) OR o.state IN ('EXECUTING','UNKNOWN'))`,[account,since])).rows;
    if(rows.some(r=>![Number(r.before),Number(r.after)].every(Number.isSafeInteger)||!Number.isFinite(Date.parse(r.updated_at))))throw Error('BUDGET_HISTORY_INVALID');
    return {increaseCents:rows.filter(r=>Date.parse(r.updated_at)>=day||['EXECUTING','UNKNOWN'].includes(r.state)).reduce((sum,r)=>sum+Math.max(0,Number(r.after)-Number(r.before)),0),changedCampaignIds:[...new Set(rows.filter(r=>Date.parse(r.updated_at)>now-cooldownMs||['EXECUTING','UNKNOWN'].includes(r.state)).map(r=>r.campaign_id))]};
  }
  async algorithmJournal(){return (await this.pool.query("SELECT id,event_type,reference,body,created_at FROM economics.ads_algorithm_journal WHERE body->>'version' IS DISTINCT FROM 'suleia-review-v6.0' ORDER BY created_at DESC LIMIT 50")).rows;}
  async latestReviewAlert(reference){return (await this.pool.query("SELECT id,body,created_at FROM economics.ads_algorithm_journal WHERE body->>'version'='suleia-review-v6.0' AND body->>'kind'='ALERT_OBSERVATION' AND body->'record'->>'key'=$1 ORDER BY created_at DESC LIMIT 1",[reference])).rows[0]||null;}
  async appendAlgorithmJournal({eventType,reference,principal,report}){
    const id=createHash('sha256').update(`${report.evidenceDigest}:${eventType}:${reference}:${principal}`).digest('hex');
    const body={eventType,reference,principal,evidenceDigest:report.evidenceDigest,observedAt:report.observedAt,range:report.range,policyVersion:report.policyVersion,mode:'SHADOW',externalWrites:0,narrative:report.narrative,campaign:reference==='ACCOUNT'?null:report.campaigns.find(c=>c.campaignId===reference)};
    const r=await this.pool.query('INSERT INTO economics.ads_algorithm_journal(id,event_type,reference,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id',[id,eventType,reference,body]);return {id,eventType,reference,recorded:r.rowCount===1,execution:'REVIEW_ONLY',externalWrites:0};
  }
  async recommendations(){return (await this.pool.query('SELECT body,state,id FROM economics.ads_recommendations ORDER BY created_at DESC LIMIT 50')).rows.map(r=>({...r.body,id:r.id,state:r.state}));}
  async saveRecommendation({action,principal,accountId}){
    const id=createHash('sha256').update(`${accountId}:${action.id}:${action.observedAt}`).digest('hex').slice(0,24);
    const body={action,principal,accountId,execution:'REVIEW_ONLY',createdAt:new Date().toISOString()};
    const r=await this.pool.query("INSERT INTO economics.ads_recommendations(id,body,state) VALUES($1,$2,'DRAFT') ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING id,body,state",[id,body]);return {...r.rows[0].body,id,state:r.rows[0].state};
  }
  async reviewRecommendation({id,principal,state}){
    if(!/^[a-f0-9]{24}$/.test(id||'')||!['APPROVED_FOR_REVIEW','DISMISSED'].includes(state))throw Error('QUERY_INVALID');
    const r=await this.pool.query("UPDATE economics.ads_recommendations SET state=$2,body=body||jsonb_build_object('reviewedBy',$3::text,'reviewedAt',now()),updated_at=now() WHERE id=$1 AND state='DRAFT' RETURNING id,body,state",[id,state,principal]);
    if(!r.rowCount){const existing=await this.pool.query('SELECT id,body,state FROM economics.ads_recommendations WHERE id=$1',[id]);if(!existing.rowCount)throw Error('NOT_FOUND');return {...existing.rows[0].body,id,state:existing.rows[0].state};}
    return {...r.rows[0].body,id,state:r.rows[0].state};
  }
  async claimDigest(key,body){return (await this.pool.query('INSERT INTO economics.ads_alert_digests(key,body) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING key',[key,body])).rowCount===1;}
  async finishDigest(key,state){await this.pool.query('UPDATE economics.ads_alert_digests SET state=$2 WHERE key=$1',[key,state]);}
  async byRequest(key){const r=await this.pool.query('SELECT id FROM economics.ads_proposals WHERE request_key=$1',[key]);return r.rows[0]?this.get(r.rows[0].id):null;}
  async createProposal(p){
    const r=await this.pool.query(`INSERT INTO economics.ads_proposals(id,request_key,body,state,expires_at) VALUES($1,$2,$3,'PENDING',to_timestamp($4/1000.0)) ON CONFLICT(request_key) DO NOTHING RETURNING id`,[p.id,p.requestKey,p,p.expiresAt]);
    return r.rows[0]?this.get(p.id):this.byRequest(p.requestKey);
  }
  async get(id){
    const r=await this.pool.query('SELECT body,state FROM economics.ads_proposals WHERE id=$1',[id]);if(!r.rows[0])return null;
    const ops=await this.pool.query('SELECT campaign_id,body,state FROM economics.ads_operations WHERE proposal_id=$1 ORDER BY campaign_id',[id]);
    const results=new Map(ops.rows.map(r=>[r.campaign_id,{...r.body,state:r.state}]));
    return {...r.rows[0].body,state:r.rows[0].state,items:r.rows[0].body.items.map(i=>({...i,result:results.get(i.campaignId)||null}))};
  }
  async claimProposal(id){const r=await this.pool.query("UPDATE economics.ads_proposals SET state='RUNNING' WHERE id=$1 AND state='PENDING' AND expires_at>now() RETURNING id",[id]);return r.rowCount===1;}
  async finish(id,state){await this.pool.query('UPDATE economics.ads_proposals SET state=$2 WHERE id=$1 AND state=$3',[id,state,['EXPIRED','STALE_POLICY_OR_MODE'].includes(state)?'PENDING':'RUNNING']);return this.get(id);}
  async cancel(id){await this.pool.query("UPDATE economics.ads_proposals SET state='CANCELLED' WHERE id=$1 AND state='PENDING'",[id]);return this.get(id);}
  async history(){const r=await this.pool.query('SELECT id FROM economics.ads_proposals ORDER BY created_at DESC LIMIT 30');return Promise.all(r.rows.map(x=>this.get(x.id)));}
  async reportHistory(user,start,end){const r=await this.pool.query(`SELECT DISTINCT p.id FROM economics.ads_proposals p LEFT JOIN economics.ads_operations o ON o.proposal_id=p.id
    WHERE p.body->'actor'->>'user'=$1 AND ((o.updated_at >= $2::timestamptz AND o.updated_at < $3::timestamptz) OR (p.state='PENDING' AND p.expires_at>now()))`,[user,start,end]);return Promise.all(r.rows.map(x=>this.get(x.id)));}
  async pendingForActor(user){const r=await this.pool.query("SELECT id FROM economics.ads_proposals WHERE state='PENDING' AND body->'actor'->>'user'=$1 AND expires_at>now() LIMIT 2",[user]);return Promise.all(r.rows.map(x=>this.get(x.id)));}
  async persistFacts(facts,client=this.pool){
    if(!facts.length)return;
    // Replace a snapshot at its full semantic key. No summation across refreshes.
    await client.query(`INSERT INTO economics.ads_insights(account_id,level,entity_id,since,until,contract,body,source_observed_at,ingested_at)
      SELECT x->>'accountId',x->>'level',x->>'entityId',(x->>'since')::date,(x->>'until')::date,x->>'contract',x,(x->>'observedAt')::timestamptz,now() FROM jsonb_array_elements($1::jsonb) x
      ON CONFLICT(account_id,level,entity_id,since,until,contract) DO UPDATE SET body=EXCLUDED.body,source_observed_at=EXCLUDED.source_observed_at,ingested_at=now()
      WHERE EXCLUDED.source_observed_at>=economics.ads_insights.source_observed_at`,[JSON.stringify(facts)]);
  }
  async persistDailySnapshot(facts,{accountId,level,since,until,contract,observedAt}){
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');await this.persistFacts(facts,c);
      for(let day=since;day<=until;day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10)){
        const members=facts.filter(f=>f.since===day).map(f=>f.entityId);
        await c.query(`INSERT INTO economics.ads_day_coverage(account_id,level,business_date,contract,entity_ids,source_observed_at)
          VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(account_id,level,business_date,contract)
          DO UPDATE SET entity_ids=EXCLUDED.entity_ids,source_observed_at=EXCLUDED.source_observed_at
          WHERE EXCLUDED.source_observed_at>=economics.ads_day_coverage.source_observed_at`,[accountId,level,day,contract,JSON.stringify(members),observedAt]);
      }
      await c.query('COMMIT');
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }
  async withCampaignLock(key,fn){
    const c=await this.pool.connect();let acquired=false;
    try{
      const lock=await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['ads-budget:'+key]);
      acquired=lock.rows[0].locked;if(!acquired)throw Error('CAMPAIGN_BUSY');
      const tx={
        unresolved:async(account,id)=>(await c.query("SELECT 1 FROM economics.ads_operations WHERE account_id=$1 AND campaign_id=$2 AND state IN ('EXECUTING','UNKNOWN') LIMIT 1",[account,id])).rowCount>0,
        operation:async(id,campaign)=>(await c.query('SELECT state,body FROM economics.ads_operations WHERE proposal_id=$1 AND campaign_id=$2',[id,campaign])).rows[0],
        claimOperation:async(id,campaign,account,body={})=>(await c.query("INSERT INTO economics.ads_operations(proposal_id,campaign_id,account_id,state,body) VALUES($1,$2,$3,'EXECUTING',$4) ON CONFLICT DO NOTHING RETURNING campaign_id",[id,campaign,account,body])).rowCount===1,
        record:(id,campaign,result)=>this.record(id,campaign,result,c),
        circuitOpen:async(account,now)=>(await c.query('SELECT 1 FROM economics.ads_circuit WHERE account_id=$1 AND open_until>to_timestamp($2/1000.0)',[account,now])).rowCount>0,
        openCircuit:async(account,until)=>c.query('INSERT INTO economics.ads_circuit(account_id,open_until) VALUES($1,to_timestamp($2/1000.0)) ON CONFLICT(account_id) DO UPDATE SET open_until=EXCLUDED.open_until',[account,until])
      };
      return await fn(tx);
    }finally{let failure;try{if(acquired)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['ads-budget:'+key]);}catch(error){failure=error;throw error;}finally{c.release(failure);}}
  }
  async record(id,campaign,result,client=this.pool){
    // Append event and update materialized operation atomically in one statement.
    await client.query(`WITH changed AS (
      INSERT INTO economics.ads_operations(proposal_id,campaign_id,account_id,state,body)
      SELECT $1,$2,body->>'accountId',$3,$4 FROM economics.ads_proposals WHERE id=$1
      ON CONFLICT(proposal_id,campaign_id) DO UPDATE SET state=EXCLUDED.state,body=economics.ads_operations.body||EXCLUDED.body,updated_at=now() RETURNING proposal_id,campaign_id
    ) INSERT INTO economics.ads_events(proposal_id,campaign_id,body) SELECT proposal_id,campaign_id,$4 FROM changed`,[id,campaign,result.state,result]);
  }
}
