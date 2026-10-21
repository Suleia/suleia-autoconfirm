import { createHash } from 'node:crypto';
export class AdsLedger {
  constructor(pool){this.pool=pool;}
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
        claimOperation:async(id,campaign,account)=>(await c.query("INSERT INTO economics.ads_operations(proposal_id,campaign_id,account_id,state,body) VALUES($1,$2,$3,'EXECUTING','{}') ON CONFLICT DO NOTHING RETURNING campaign_id",[id,campaign,account])).rowCount===1,
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
      ON CONFLICT(proposal_id,campaign_id) DO UPDATE SET state=EXCLUDED.state,body=EXCLUDED.body,updated_at=now() RETURNING proposal_id,campaign_id
    ) INSERT INTO economics.ads_events(proposal_id,campaign_id,body) SELECT proposal_id,campaign_id,$4 FROM changed`,[id,campaign,result.state,result]);
  }
}
