import { randomBytes, createHash } from 'node:crypto';
import { CONTRACT, normalizeInsight, windowFor } from './metrics.mjs';
import { budgetAfter, parseAdsIntent } from './intent.mjs';
import { diagnose } from './diagnostics.mjs';
import {manualAutopilotReasons,AUTOPILOT_VERSION,autopilotMetric} from './autopilot/policy.mjs';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const match = (name, selector) => name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(selector.toLowerCase());
export const LIVE_COMPILED = true; // Owner-authorized budget-only release; runtime gates remain mandatory.

export class AdsIntelligence {
  constructor({ reader, ledger, policy, allowedActors, accountId, mode='SIMULATION', now=()=>Date.now(), writer=null, liveCompiled=LIVE_COMPILED }) {
    if (!['SIMULATION','SHADOW','LIVE'].includes(mode)) throw Error('MODE_INVALID');
    Object.assign(this,{reader,ledger,policy,allowedActors,accountId:String(accountId).replace(/^act_/,''),mode,now,writer,liveCompiled});
  }
  authorize(actor) {
    if (!actor || actor.chat !== actor.user || !this.allowedActors.includes(String(actor.user))) throw Error('ACTOR_UNAUTHORIZED');
  }
  policyDigest(){return hash(this.autopilot?.config.enabled?{legacy:this.policy,autopilot:this.autopilot.config}:this.policy);}
  async snapshot(period, level='campaign', {daily=false,persist=true}={}) {
    const start=this.now(), account=await this.reader.readAccount();
    if (String(account.id).replace(/^act_/,'')!==this.accountId || account.currency!=='EUR' || account.timezone_name!=='Europe/Madrid' || account.account_status!==1) throw Error('ACCOUNT_NOT_ELIGIBLE');
    const range=windowFor(period,start,account.timezone_name);
    const rows=await this.reader.readInsights({...range,level,daily});
    const observedAt=new Date(start).toISOString();
    const facts=rows.map(row=>normalizeInsight(row,{level,accountId:this.accountId,contract:CONTRACT,observedAt,complete:true,currency:account.currency,timezone:account.timezone_name}));
    if (new Set(facts.map(f=>`${f.entityId}:${f.since}:${f.until}`)).size!==facts.length || facts.some(f=>!/^\d+$/.test(f.entityId)||!/^\d{4}-\d{2}-\d{2}$/.test(f.since)||!/^\d{4}-\d{2}-\d{2}$/.test(f.until)||f.since<range.since||f.until>range.until||f.since>f.until)) throw Error('INSIGHTS_IDENTITY_INVALID');
    if (persist&&this.ledger.persistFacts) await this.ledger.persistFacts(facts);
    return {account,range,facts,observedAt,complete:true,contract:CONTRACT};
  }
  async inventory() {
    const observedAt=this.now();
    const today=windowFor('hoy',this.now());
    const [campaigns,ads,rules,accountSpend]=await Promise.all([this.reader.readCampaigns(),this.reader.readDelivery(),this.reader.readRules(),this.autopilot?.config.enabled&&this.reader.readAccountDaySpend?this.reader.readAccountDaySpend(today):null]);
    return {campaigns,ads,rules,accountSpend,observedAt};
  }
  policyReasons(campaign,metric,intent,inventory) {
    const p=this.policy,reasons=[];
    if (String(campaign.account_id)!==this.accountId) reasons.push('ACCOUNT_MISMATCH');
    if(this.mode==='LIVE'&&!p.liveAccountBudgets&&!p.liveCampaignIds?.includes(String(campaign.id)))reasons.push('LIVE_CANARY_ONLY');
    if(this.mode==='LIVE'&&(!Number.isSafeInteger(p.maxAggregateIncreaseCents)||p.maxAggregateIncreaseCents<=0||!Number.isFinite(p.campaignCooldownMs)||p.campaignCooldownMs<86400000))reasons.push('ACCUMULATION_POLICY_NOT_CONFIGURED');
    if (campaign.status!=='ACTIVE'||campaign.effective_status!=='ACTIVE') reasons.push('CAMPAIGN_INACTIVE');
    if (!inventory.ads.some(a=>String(a.campaign_id)===String(campaign.id)&&a.status==='ACTIVE'&&a.effective_status==='ACTIVE')) reasons.push('NO_ELIGIBLE_AD');
    if (!Number.isSafeInteger(Number(campaign.daily_budget))||Number(campaign.daily_budget)<=0||Number(campaign.lifetime_budget)>0) reasons.push('CAMPAIGN_DAILY_BUDGET_REQUIRED');
    // Native rules can target arbitrary filters; conservative block until a
    // reviewed conflict resolver exists. Do not disable rules to make room.
    if (inventory.rules.some(r=>r.status!=='DISABLED')) reasons.push('AUTOMATION_CONFLICT');
    if (!Number.isFinite(inventory.observedAt)||this.now()-inventory.observedAt>p.maxAgeMs||this.now()-inventory.observedAt<-5000) reasons.push('STALE_INVENTORY');
    if (intent.filter) {
      if (!metric||!metric.complete||this.now()-Date.parse(metric.observedAt)>p.maxAgeMs) reasons.push('STALE_OR_MISSING_METRIC');
      if (!['VALID','ZERO'].includes(metric?.roasStatus)) reasons.push('ROAS_'+(metric?.roasStatus||'MISSING'));
      if (![p.minSpend,p.minPurchases,p.minImpressions].every(x=>Number.isFinite(x)&&x>0)) reasons.push('SAMPLE_POLICY_NOT_CONFIGURED');
      else if (metric?.spend<p.minSpend||metric?.purchases<p.minPurchases||metric?.impressions<p.minImpressions) reasons.push('INSUFFICIENT_SAMPLE');
      if (metric?.roas===null||metric?.roas===undefined||!(intent.filter.operator==='gt'?metric.roas>intent.filter.threshold:metric.roas<intent.filter.threshold)) reasons.push('ROAS_FILTER_NOT_MET');
    }
    let after=null;
    try {after=intent.mode==='scheduled'?intent.targets[String(campaign.id)]:budgetAfter(Number(campaign.daily_budget),intent);} catch {reasons.push('AMOUNT_INVALID');}
    if (!Number.isSafeInteger(after)||after<=0||after===Number(campaign.daily_budget)) reasons.push('BUDGET_INVALID_OR_UNCHANGED');
    if(intent.direction&&(intent.direction==='increase'?after<Number(campaign.daily_budget):after>Number(campaign.daily_budget)))reasons.push('DIRECTION_CONFLICT');
    if (!Number.isSafeInteger(p.maxBudgetCents)||!Number.isFinite(p.maxChangePercent)||p.maxChangePercent<=0) reasons.push('LIMIT_POLICY_NOT_CONFIGURED');
    else {
      if (after>p.maxBudgetCents) reasons.push('MAX_BUDGET');
      if (after<(p.minBudgetCents||1)) reasons.push('MIN_BUDGET');
      if (Math.abs(after-Number(campaign.daily_budget))*100>Number(campaign.daily_budget)*p.maxChangePercent) reasons.push('MAX_CHANGE_PERCENT');
    }
    if(this.autopilot?.config.enabled&&intent.mode!=='scheduled')reasons.push(...manualAutopilotReasons({before:Number(campaign.daily_budget),after,metric,now:this.now(),config:this.autopilot.config,inventory}));
    return {after,reasons};
  }
  async proposeScheduled({slot,decisions,evidence,config}) {
    if(!this.autopilot||(this.mode==='LIVE'&&!config.liveCompiled)||!config.enabled||config.policy.version!==AUTOPILOT_VERSION)throw Error('AUTOPILOT_LIVE_NOT_AUTHORIZED');
    const requestKey=`${this.accountId}:AUTOPILOT:${AUTOPILOT_VERSION}:${slot.key}`,requestHash=hash({slot:slot.key,version:AUTOPILOT_VERSION});
    const prior=await this.ledger.byRequest(requestKey);if(prior)return prior;
    const targets=Object.fromEntries(decisions.map(d=>[d.campaignId,d.after]));
    const intent={kind:'budget',mode:'scheduled',period:'hoy',targets};
    const items=[];
    for(const decision of decisions){
      const c=evidence.inventory.campaigns.find(c=>String(c.id)===decision.campaignId);
      const base=this.policyReasons(c,decision.metric,intent,evidence.inventory),learning=this.learningAssessment?(evidence.learning?.get(String(c.id))||{reasons:['LEARNING_EVIDENCE_PREPARING_OR_UNAVAILABLE'],policy:null}):null;
      const reasons=[...new Set([...decision.reasons,...base.reasons,...(learning?.reasons||[]),...(decision.action==='HOLD'?['AUTOPILOT_HOLD']:[])])];
      items.push({...decision,reasons,learning,status:'PENDING'});
    }
    const now=this.now(),proposal={id:hash(requestKey).slice(0,16),requestKey,requestHash,actor:{user:'SYSTEM_AUTOPILOT',chat:'SYSTEM_AUTOPILOT'},origin:'AUTOPILOT',request:`Autopilot ${slot.key}`,intent,
      accountId:this.accountId,contract:CONTRACT,mode:this.mode,state:'PENDING',createdAt:now,expiresAt:now+300000,policyHash:this.policyDigest(),
      selectedCount:items.length,inventoryCount:evidence.inventory.campaigns.length,items,autopilot:{slot,version:AUTOPILOT_VERSION,config,observedAt:evidence.snapshot.observedAt}};
    return this.ledger.createProposal(proposal);
  }
  async confirmScheduled(id) {
    if(!this.autopilot||(this.mode==='LIVE'&&!this.autopilot.config.liveCompiled))throw Error('AUTOPILOT_LIVE_NOT_AUTHORIZED');
    const p=await this.ledger.get(id);if(!p||p.origin!=='AUTOPILOT')throw Error('AUTOPILOT_PROPOSAL_INVALID');
    return this.ledger.withAccountBudgetLock(this.accountId,()=>this.confirmLocked({id,actor:p.actor,automatic:true}));
  }
  async propose({actor,requestKey,text}) {
    this.authorize(actor);
    if (!/^[\w:.-]{1,160}$/.test(requestKey||'')||typeof text!=='string'||text.length>2000) throw Error('REQUEST_INVALID');
    const key=`${this.accountId}:${actor.user}:${requestKey}`;
    const prior=await this.ledger.byRequest(key);
    if (prior) {if(prior.requestHash!==hash(text))throw Error('IDEMPOTENCY_PAYLOAD_CONFLICT');return prior;}
    const intent=parseAdsIntent(text);
    if (intent.kind!=='budget') return {state:'CLARIFICATION',question:intent.question||'Usa la consulta de análisis para esa petición.'};
    if(this.autopilot?.config.enabled&&intent.unit==='percent')return {state:'CLARIFICATION',question:'Budget Autopilot V5.1 utiliza importes en euros. Indica el cambio absoluto o el presupuesto final.'};
    const [inventory,snapshot]=await Promise.all([this.inventory(),this.snapshot(intent.period||'hoy')]);
    const selected=intent.selector==='ALL_ACTIVE'?inventory.campaigns.filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE'):inventory.campaigns.filter(c=>String(c.id)===intent.selector||match(c.name,intent.selector));
    if (intent.selector!=='ALL_ACTIVE'&&selected.length!==1) return {state:'CLARIFICATION',question:selected.length?'Hay varias campañas. Indica el ID exacto.':'No encuentro esa campaña. Indica el ID exacto.'};
    const metrics=new Map(snapshot.facts.map(f=>[f.campaignId,this.autopilot?.config.enabled?autopilotMetric(f):f]));
    const items=[];
    for(const c of selected){const metric=metrics.get(String(c.id))||null,decision=this.policyReasons(c,metric,intent,inventory),learning=this.learningAssessment?await this.learningAssessment(c):null;
      if(this.autopilot?.config.enabled)decision.reasons.push(...await this.autopilot.manualAssessment(c,decision.after));
      items.push({campaignId:String(c.id),name:c.name,before:c.daily_budget===null||c.daily_budget===undefined?null:Number(c.daily_budget),after:decision.after,reasons:[...new Set([...decision.reasons,...(learning?.reasons||[])])],learning,metric,status:'PENDING'});}
    let usage=null;if(this.ledger.budgetUsage)usage=await this.ledger.budgetUsage(this.accountId,this.now(),this.policy.campaignCooldownMs||86400000);
    if(usage){for(const item of items)if(usage.changedCampaignIds.includes(item.campaignId))item.reasons.push('CAMPAIGN_COOLDOWN');
      const increase=items.filter(i=>!i.reasons.length).reduce((s,i)=>s+Math.max(0,i.after-i.before),0);
      if(increase+usage.increaseCents>this.policy.maxAggregateIncreaseCents)for(const i of items)if(!i.reasons.length)i.reasons.push('AGGREGATE_DAILY_LIMIT');}
    const id=randomBytes(8).toString('hex');
    const p={id,requestKey:key,requestHash:hash(text),actor,request:text,intent,accountId:this.accountId,contract:CONTRACT,mode:this.mode,state:'PENDING',createdAt:this.now(),expiresAt:this.now()+300000,policyHash:this.policyDigest(),inventoryCount:inventory.campaigns.length,selectedCount:selected.length,items};
    if(this.autopilot?.config.enabled)p.manualHoldUntil='Hasta las 22:30 Europe/Madrid del día de ejecución; nunca prevalece sobre la reducción nocturna.';
    const saved=await this.ledger.createProposal(p);
    if(saved.requestHash!==p.requestHash)throw Error('IDEMPOTENCY_PAYLOAD_CONFLICT');
    return saved;
  }
  async confirm({id,actor}) {
    this.authorize(actor);
    if(this.mode!=='LIVE'&&!this.autopilot?.config.enabled)return this.confirmLocked({id,actor});
    if(this.mode==='LIVE'&&(!this.liveCompiled||!this.writer||!this.ledger.withAccountBudgetLock||!this.ledger.budgetUsage))throw Error('LIVE_NOT_AUTHORIZED');
    return this.ledger.withAccountBudgetLock(this.accountId,()=>this.confirmLocked({id,actor}));
  }
  async confirmLocked({id,actor,automatic=false}) {
    if(!automatic)this.authorize(actor);
    let p=await this.ledger.get(id);if (!p||p.actor.user!==actor.user||p.actor.chat!==actor.chat) throw Error('PROPOSAL_NOT_AUTHORIZED');
    if(automatic&&(!this.autopilot||(this.mode==='LIVE'&&!this.autopilot.config.liveCompiled)||p.origin!=='AUTOPILOT'||p.actor.user!=='SYSTEM_AUTOPILOT'))throw Error('AUTOPILOT_LIVE_NOT_AUTHORIZED');
    if (p.state!=='PENDING') return p;
    if (this.now()>=p.expiresAt) return this.ledger.finish(id,'EXPIRED');
    // A simulation proposal can never turn LIVE after a configuration change.
    if (p.mode!==this.mode||p.policyHash!==this.policyDigest()) return this.ledger.finish(id,'STALE_POLICY_OR_MODE');
    if (this.mode==='LIVE'&&(!this.liveCompiled||!this.writer)) throw Error('LIVE_NOT_AUTHORIZED');
    if (!await this.ledger.claimProposal(id)) return this.ledger.get(id);
    try {
      for (const item of p.items) {
        if (item.reasons.length) {await this.ledger.record(id,item.campaignId,{state:'BLOCKED',reasons:item.reasons});continue;}
        await this.ledger.withCampaignLock(`${this.accountId}:${item.campaignId}`,async tx=>{
          if (await tx.unresolved(this.accountId,item.campaignId)) {await tx.record(id,item.campaignId,{state:'BLOCKED',reasons:['UNRESOLVED_OPERATION']});return;}
          if (await tx.circuitOpen(this.accountId,this.now())) {await tx.record(id,item.campaignId,{state:'BLOCKED',reasons:['CIRCUIT_OPEN']});return;}
          const [inventory,snapshot]=await Promise.all([this.inventory(),this.snapshot(p.intent.period||'hoy')]);
          const c=inventory.campaigns.find(c=>String(c.id)===item.campaignId), rawMetric=snapshot.facts.find(f=>f.campaignId===item.campaignId),metric=this.autopilot?.config.enabled?autopilotMetric(rawMetric):rawMetric;
          const result=c?this.policyReasons(c,metric,p.intent,inventory):{reasons:['CAMPAIGN_MISSING']};
          if(c&&automatic){const current=await this.autopilot.validate(c,metric,p);result.reasons.push(...current.reasons);if(current.after!==item.after)result.reasons.push('AUTOPILOT_DECISION_CHANGED');}
          if(c&&!automatic&&this.autopilot?.config.enabled)result.reasons.push(...await this.autopilot.manualAssessment(c,result.after));
          if(c&&this.learningAssessment){const learning=automatic?await this.autopilot.learningAssessment(c):await this.learningAssessment(c);result.reasons.push(...learning.reasons);if(hash(learning.policy)!==hash(item.learning?.policy))result.reasons.push('LEARNING_POLICY_CHANGED');}
          if (this.now()>=p.expiresAt||!c||Number(c.daily_budget)!==item.before||result.after!==item.after||result.reasons.length) {await tx.record(id,item.campaignId,{state:'STALE',reasons:this.now()>=p.expiresAt?['EXPIRED']:['REVALIDATION_FAILED',...result.reasons]});return;}
          // Preserve the local business day and reject changed evidence rather
          // than carrying yesterday's selection into a new day.
          if (p.intent.filter&&hash({since:metric.since,until:metric.until,spend:metric.spend,purchases:metric.purchases,value:metric.purchaseValue})!==hash({since:item.metric.since,until:item.metric.until,spend:item.metric.spend,purchases:item.metric.purchases,value:item.metric.purchaseValue})) {await tx.record(id,item.campaignId,{state:'STALE',reasons:['METRIC_CHANGED']});return;}
          if (this.mode!=='LIVE') {await tx.record(id,item.campaignId,{state:'SIMULATED',before:item.before,after:item.after,metric,mode:this.mode,externalWrites:0});return;}
          const usage=await this.ledger.budgetUsage(this.accountId,this.now(),this.policy.campaignCooldownMs);
          if(usage.changedCampaignIds.includes(item.campaignId)||usage.increaseCents+Math.max(0,item.after-item.before)>this.policy.maxAggregateIncreaseCents){await tx.record(id,item.campaignId,{state:'BLOCKED',reasons:[usage.changedCampaignIds.includes(item.campaignId)?'CAMPAIGN_COOLDOWN':'AGGREGATE_DAILY_LIMIT']});return;}
          // Durable intent must precede the only mutating call. Crash/timeout
          // remains UNKNOWN/EXECUTING and requires read-only reconciliation.
          if (!await tx.claimOperation(id,item.campaignId,this.accountId)) return;
          try {
            const response=await this.writer.setDailyBudget(item.campaignId,item.after,{expectedBefore:item.before});
            const after=await this.reader.readCampaign(item.campaignId);
            if (response?.success!==true||String(after.id)!==item.campaignId||String(after.account_id)!==this.accountId||Number(after.daily_budget)!==item.after||Number(after.lifetime_budget)>0) throw Error('READBACK_MISMATCH');
            await tx.record(id,item.campaignId,{state:'VERIFIED',before:item.before,after:item.after,response:{success:true},verifiedAt:this.now(),externalWrites:1});
          } catch (error) {
            await tx.record(id,item.campaignId,{state:error.notSent===true?'STALE':error.definitiveRejection===true?'FAILED':'UNKNOWN',reasons:[error.notSent===true?'LAST_MOMENT_REVALIDATION_FAILED':error.definitiveRejection===true?`META_REJECTED_${error.status}`:'PROVIDER_RESULT_UNKNOWN'],before:item.before,after:item.after});
            await tx.openCircuit(this.accountId,this.now()+300000);
          }
        });
      }
      const outcomes=await this.ledger.get(id);
      return this.ledger.finish(id,this.mode==='LIVE'?(outcomes.items.some(i=>!i.result||['UNKNOWN','EXECUTING'].includes(i.result.state))?'REVIEW_REQUIRED':'COMPLETED'):'SIMULATED');
    } catch {
      // Do not mask already committed per-campaign outcomes on partial failure.
      const current=await this.ledger.get(id);
      for(const item of current.items)if(!item.result)await this.ledger.record(id,item.campaignId,{state:'BLOCKED',reasons:['EXECUTION_INTERRUPTED_REVIEW_REQUIRED']});
      return this.ledger.finish(id,'REVIEW_REQUIRED');
    }
  }
  async cancel({id,actor}) {this.authorize(actor);const p=await this.ledger.get(id);if(!p||p.actor.user!==actor.user)throw Error('PROPOSAL_NOT_AUTHORIZED');return this.ledger.cancel(id);}
  async reconcile({id,actor}) {
    this.authorize(actor);const p=await this.ledger.get(id);if(!p||p.actor.user!==actor.user)throw Error('PROPOSAL_NOT_AUTHORIZED');
    for(const item of p.items) await this.ledger.withCampaignLock(`${this.accountId}:${item.campaignId}`,async tx=>{
      const op=await tx.operation(id,item.campaignId);
      if(!op||!['EXECUTING','UNKNOWN'].includes(op.state))return;
      const row=await this.reader.readCampaign(item.campaignId);
      if(String(row.account_id)!==this.accountId)throw Error('ACCOUNT_MISMATCH');
      if(Number(row.daily_budget)===item.after)await tx.record(id,item.campaignId,{state:'RECONCILED',before:item.before,after:item.after,note:'Observed requested budget; attribution to this operation unproven.',externalWrites:0});
    });
    return this.ledger.get(id);
  }
  async analyze({period,level='campaign',selector=null}) {
    const snapshot=await this.snapshot(period,level), days=(Date.parse(snapshot.range.until)-Date.parse(snapshot.range.since))/86400000+1;
    const until=new Date(Date.parse(snapshot.range.since)-86400000).toISOString().slice(0,10), since=new Date(Date.parse(snapshot.range.since)-days*86400000).toISOString().slice(0,10);
    const before=await this.reader.readInsights({since,until,level});
    const prior=new Map(before.map(r=>{const m=normalizeInsight(r,{level,complete:true,contract:CONTRACT});return [m.entityId,m];}));
    const entities=await this.reader.readEntities(level),byId=new Map(snapshot.facts.map(f=>[f.entityId,f]));
    for(const entity of entities)if(!byId.has(String(entity.id))){
      const f=normalizeInsight({[level+'_id']:entity.id,[level+'_name']:entity.name,campaign_id:level==='campaign'?entity.id:entity.campaign_id,date_start:snapshot.range.since,date_stop:snapshot.range.until},{level,accountId:this.accountId,observedAt:snapshot.observedAt,complete:true,contract:CONTRACT,currency:'EUR',timezone:'Europe/Madrid'});
      byId.set(f.entityId,{...f,source:'META_NO_INSIGHT_ROW'});
    }
    let facts=[...byId.values()];
    if(selector){const campaigns=await this.reader.readCampaigns();const ids=new Set(campaigns.filter(c=>String(c.id)===selector||match(c.name,selector)).map(c=>String(c.id)));facts=facts.filter(f=>ids.has(f.campaignId));}
    // Today's incomplete period cannot be judged against a full prior day.
    return {...snapshot,facts:facts.map(f=>({...f,diagnoses:diagnose(f,snapshot.range.partial?null:prior.get(f.entityId),this.policy)})),comparison:{since,until,comparable:!snapshot.range.partial},netProfitAvailable:false,policy:this.policy,mode:this.mode};
  }
}
