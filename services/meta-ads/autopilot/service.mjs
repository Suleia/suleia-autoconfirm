import {AUTOPILOT_VERSION,evaluateAutopilot,nightTarget,autopilotMetric,consolidatedPolicy} from './policy.mjs';
import {reviewSlot,nextReview,madridTime,REVIEW_TIMES} from './schedule.mjs';

export class BudgetAutopilot {
  constructor({engine,ledger,config,now=()=>Date.now(),readConstraints=null,learningWaitMs=3000}) {
    Object.assign(this,{engine,ledger,config,now,readConstraints,learningWaitMs});this.busy=false;this.minimumReceipts=new Map();this.constraintsTask=null;
    engine.autopilot=this;
  }
  async learningAssessment(campaign,{waitMs=this.learningWaitMs}={}) {
    if(!this.engine.learningAssessment)return null;
    let timer;
    const pending=()=>({reasons:['LEARNING_EVIDENCE_PREPARING_OR_UNAVAILABLE'],policy:null});
    try {
      return await Promise.race([
        Promise.resolve().then(()=>this.engine.learningAssessment(campaign)),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(pending()),waitMs);})
      ]);
    } catch {return pending();}
    finally {clearTimeout(timer);}
  }
  async constraints() {
    // Coalesce concurrent reads only. Each new capture/revalidation still gets
    // fresh provider constraints; a failed read is never cached as verified.
    if(!this.constraintsTask)this.constraintsTask=this.readFreshConstraints().finally(()=>{this.constraintsTask=null;});
    return this.constraintsTask;
  }
  async readFreshConstraints() {
    if(this.readConstraints)return this.readConstraints();
    try {
      const rows=await this.engine.reader.readMinimumBudgets();
      const perCampaign={};
      for(const row of [...(this.config.verifiedMinimums||[]),...this.minimumReceipts.values()])if(row.accountId===this.engine.accountId&&Date.parse(row.verifiedAt)<=this.now()&&Date.parse(row.validUntil)>this.now())perCampaign[row.campaignId]={verified:true,minimumCents:row.minimumCents,reference:row.reference,verifiedAt:row.verifiedAt,validUntil:row.validUntil};
      if(this.config.mode==='LIVE'&&consolidatedPolicy(this.config)&&this.engine.writer?.validateDailyBudget){
        const campaigns=await this.engine.reader.readCampaigns();
        for(const c of campaigns.filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE'&&Number.isSafeInteger(Number(c.daily_budget))&&Number(c.daily_budget)>0)){
          if(perCampaign[String(c.id)]?.minimumCents===this.config.approved.minimumBudgetCents)continue;
          try {
            await this.engine.writer.validateDailyBudget(String(c.id),this.config.approved.minimumBudgetCents,{expectedBefore:Number(c.daily_budget)});
            const at=this.now(),receipt={accountId:this.engine.accountId,campaignId:String(c.id),currency:'EUR',minimumCents:this.config.approved.minimumBudgetCents,reference:this.config.approved.approvalReference,verifiedAt:new Date(at).toISOString(),validUntil:new Date(at+86400000).toISOString()};
            this.minimumReceipts.set(String(c.id),receipt);perCampaign[String(c.id)]={...receipt,verified:true};
          } catch {perCampaign[String(c.id)]={verified:false,reason:'META_MINIMUM_VALIDATION_UNAVAILABLE'};}
        }
      }
      // The account endpoint publishes different billing/optimization categories.
      // Taking their maximum as every campaign's minimum would invent a mapping.
      return {verified:false,minimumCents:null,perCampaign,accountMinimums:rows.filter(r=>r.currency==='EUR'),scope:'ACCOUNT_CATEGORIES_REQUIRE_CAMPAIGN_VERIFICATION',observedAt:new Date(this.now()).toISOString()};
    } catch {return {verified:false,minimumCents:null,reason:'META_MINIMUM_UNAVAILABLE'};}
  }
  async capture({learningWaitMs=this.learningWaitMs}={}) {
    const at=this.now(),date=madridTime(at).date;
    const [inventory,snapshot,history,constraints]=await Promise.all([this.engine.inventory(),this.engine.snapshot('hoy','campaign',{persist:false}),this.ledger.autopilotHistory(this.engine.accountId,at),this.constraints()]);
    if(madridTime(this.now()).date!==date||snapshot.range.since!==date)throw Error('AUTOPILOT_DAY_CHANGED');
    snapshot.facts=snapshot.facts.map(autopilotMetric);
    const learning=new Map();
    if(this.engine.learningAssessment)await Promise.all(inventory.campaigns.filter(c=>c.effective_status==='ACTIVE').map(async c=>{learning.set(String(c.id),await this.learningAssessment(c,{waitMs:learningWaitMs}));}));
    return {inventory,snapshot,history,constraints,at,learning};
  }
  decisions(evidence,slot) {
    const metrics=new Map(evidence.snapshot.facts.map(f=>[f.campaignId,f]));
    const decisions=evidence.inventory.campaigns.filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE').map(c=>evaluateAutopilot({campaign:c,metric:metrics.get(String(c.id)),slot,now:this.now(),config:this.config,history:evidence.history,constraints:evidence.constraints,accountSpend:evidence.inventory.accountSpend}));
    const intent={mode:'scheduled',targets:Object.fromEntries(decisions.map(d=>[d.campaignId,d.after]))};
    for(const d of decisions)if(d.action!=='HOLD'){
      const campaign=evidence.inventory.campaigns.find(c=>String(c.id)===d.campaignId);
      d.reasons.push(...this.engine.policyReasons(campaign,d.metric,intent,evidence.inventory).reasons,...(evidence.learning?.get(d.campaignId)?.reasons||[]));
    }
    const sumBefore=decisions.reduce((sum,d)=>sum+(Number.isSafeInteger(d.before)?d.before:0),0);
    if(decisions.some(d=>!Number.isSafeInteger(d.before)||d.before<=0))for(const d of decisions)if(d.after>d.before)d.reasons.push('GLOBAL_EXPOSURE_UNVERIFIED');
    const proposed=sumBefore+decisions.filter(d=>!d.reasons.length).reduce((sum,d)=>sum+Math.max(0,d.after-d.before),0);
    if(this.config.approved.globalExposureCents&&proposed>this.config.approved.globalExposureCents)for(const d of decisions)if(d.after>d.before){d.reasons.push('GLOBAL_EXPOSURE_LIMIT');d.state='BLOCKED';}
    const previousIncrease=evidence.history.filter(p=>madridTime(p.createdAt).date===madridTime(this.now()).date).reduce((sum,p)=>sum+p.items.filter(i=>['VERIFIED','RECONCILED','EXECUTING','UNKNOWN'].includes(i.result?.state)||(p.mode===this.config.mode&&i.result?.state==='SIMULATED')).reduce((s,i)=>s+Math.max(0,i.after-i.before),0),0);
    const newIncrease=decisions.filter(d=>!d.reasons.length).reduce((s,d)=>s+Math.max(0,d.after-d.before),0);
    if(!Number.isSafeInteger(this.config.legacy.maxAggregateIncreaseCents)||previousIncrease+newIncrease>this.config.legacy.maxAggregateIncreaseCents)for(const d of decisions)if(d.after>d.before)d.reasons.push('AGGREGATE_DAILY_LIMIT');
    for(const d of decisions){d.reasons=[...new Set(d.reasons)];if(d.reasons.length)d.state='BLOCKED';}
    return decisions;
  }
  async validate(campaign,metric,proposal) {
    const slot=reviewSlot(this.now());
    if(!slot||slot.key!==proposal.autopilot.slot.key)return {after:null,reasons:['AUTOPILOT_SLOT_EXPIRED']};
    const [history,constraints,inventory]=await Promise.all([this.ledger.autopilotHistory(this.engine.accountId,this.now()),this.constraints(),this.engine.inventory()]);
    const current=this.decisions({snapshot:{facts:[metric]},history,constraints,inventory},slot).find(d=>d.campaignId===String(campaign.id));
    return current||{after:null,reasons:['CAMPAIGN_MISSING']};
  }
  async manualAssessment(campaign,after,{constraints:capturedConstraints}={}) {
    const constraints=capturedConstraints===undefined?await this.constraints():capturedConstraints,minimum=constraints?.perCampaign?constraints.perCampaign[String(campaign.id)]:constraints,reasons=[];
    if(!minimum?.verified)reasons.push('META_MINIMUM_NOT_VERIFIED');
    else if(after<minimum.minimumCents)reasons.push('META_MINIMUM_CONFLICT');
    if(this.config.mode!=='LIVE'){
      const history=await this.ledger.autopilotHistory(this.engine.accountId,this.now());
      const simulated=history.filter(p=>p.mode===this.config.mode&&madridTime(p.createdAt).date===madridTime(this.now()).date).flatMap(p=>p.items.filter(i=>i.result?.state==='SIMULATED').map(i=>({p,i})));
      if(!consolidatedPolicy(this.config)&&simulated.some(({p,i})=>i.campaignId===String(campaign.id)&&this.now()-p.createdAt<(this.config.legacy.campaignCooldownMs||86400000)))reasons.push('CAMPAIGN_COOLDOWN');
      const usage=await this.ledger.budgetUsage(this.engine.accountId,this.now());
      if(simulated.reduce((s,{i})=>s+Math.max(0,i.after-i.before),0)+usage.increaseCents+Math.max(0,after-Number(campaign.daily_budget))>this.config.legacy.maxAggregateIncreaseCents)reasons.push('AGGREGATE_DAILY_LIMIT');
    }
    return reasons;
  }
  async tick() {
    if(!this.config.enabled||this.busy)return {state:'IDLE',externalWrites:0};
    const slot=reviewSlot(this.now());if(!slot){
      // Warm the existing coalesced GET-only evidence task shortly before the
      // next review, so a cold history read does not consume its one-minute slot.
      const until=Date.parse(nextReview(this.now()))-this.now();
      if(until>0&&until<=45000&&this.engine.prepareBudgetEvidence&&!this.warming){
        this.warming=Promise.resolve().then(()=>this.engine.prepareBudgetEvidence()).catch(()=>null).finally(()=>{this.warming=null;});
      }
      return {state:'NO_CURRENT_SLOT',externalWrites:0};
    }
    this.busy=true;
    try {
      const claimed=await this.ledger.claimAutopilotSlot(this.engine.accountId,slot,this.now());
      if(!claimed)return {state:'ALREADY_CLAIMED',slot:slot.key,externalWrites:0};
      let proposalId=null;
      try {
        const evidence=await this.capture({learningWaitMs:consolidatedPolicy(this.config)?20000:this.learningWaitMs});
        if(reviewSlot(this.now())?.key!==slot.key)throw Error('AUTOPILOT_SLOT_EXPIRED');
        const decisions=this.decisions(evidence,slot);
        const proposal=await this.engine.proposeScheduled({slot,decisions,evidence,config:this.config});
        proposalId=proposal.id;
        const result=await this.engine.confirmScheduled(proposal.id);
        const outcomes=result.items.map(i=>({campaignId:i.campaignId,state:i.result?.state||'UNKNOWN',reasons:i.result?.reasons||i.reasons}));
        const hasUnknown=outcomes.some(i=>['UNKNOWN','EXECUTING'].includes(i.state));
        const body={version:AUTOPILOT_VERSION,slot,proposalId:result.id,mode:this.config.mode,externalWrites:hasUnknown?null:result.items.reduce((s,i)=>s+(i.result?.externalWrites||0),0),completedAt:this.now(),decisions,outcomes,
          executionState:hasUnknown?'UNKNOWN_RESULT':outcomes.length>0&&outcomes.every(i=>i.state==='VERIFIED')?'VERIFIED':outcomes.some(i=>i.state==='VERIFIED')?'PARTIAL_FAILURE':this.config.mode==='LIVE'?'BLOCKED':'SIMULATED',minimumReceipts:evidence.constraints?.perCampaign||{}};
        // A SHADOW night target is a projection, never verified enforcement.
        if(slot.time==='23:59')body.finalCheck={state:'NOT_ENFORCED_SHADOW',observedBudgets:decisions.map(d=>({campaignId:d.campaignId,actualCents:d.before,targetCents:d.nightTargetCents,withinTarget:d.before<=d.nightTargetCents}))};
        if(slot.time==='23:59'&&this.config.mode==='LIVE'){
          const [inventory,snapshot]=await Promise.all([this.engine.inventory(),this.engine.snapshot('hoy','campaign',{persist:false})]);
          const sameDay=madridTime(this.now()).date===slot.date&&snapshot.range.since===slot.date;
          const observedBudgets=inventory.campaigns.filter(c=>c.effective_status==='ACTIVE').map(c=>{const metric=snapshot.facts.find(m=>m.campaignId===String(c.id)),target=nightTarget(metric,this.config.policy).cents,actual=Number(c.daily_budget);return {campaignId:String(c.id),actualCents:actual,targetCents:target,withinTarget:Number.isSafeInteger(actual)&&actual>0&&actual<=target};});
          body.finalCheck={state:observedBudgets.length===0?'NO_ACTIVE_CAMPAIGNS':sameDay&&observedBudgets.every(c=>c.withinTarget)&&!hasUnknown?'VERIFIED_WITHIN_CAP':'CRITICAL_UNVERIFIED_CAP',observedBudgets,observedAt:snapshot.observedAt,sameDay};
        }
        await this.ledger.finishAutopilotSlot(this.engine.accountId,slot.key,'COMPLETE',body);
        return {...body,state:result.state};
      } catch {
        const body={version:AUTOPILOT_VERSION,slot,proposalId,code:slot.time==='23:59'?'CRITICAL_UNVERIFIED_CAP':'AUTOPILOT_REVIEW_FAILED',externalWrites:this.config.mode==='LIVE'?null:0};
        await this.ledger.finishAutopilotSlot(this.engine.accountId,slot.key,'FAILED',body);
        return {state:'FAILED',...body};
      }
    } finally {this.busy=false;}
  }
  async overview() {
    const evidence=await this.capture(),at=this.now(),local=madridTime(at);
    const slots=await this.ledger.autopilotSlots(this.engine.accountId,at);
    const nextAt=nextReview(at),hypothetical=reviewSlot(Date.parse(nextAt));
    const interrupted=slots.filter(s=>s.state==='EXECUTING'&&at-Date.parse(s.created_at)>300000);
    const campaigns=this.decisions(evidence,hypothetical);
    const timeline=evidence.history.flatMap(p=>p.items.map(i=>({at:p.createdAt,campaignId:i.campaignId,name:i.name,before:i.before,after:i.after,mode:p.mode,origin:p.origin||'MANUAL',state:i.result?.state||p.state,actor:p.origin==='AUTOPILOT'?'SYSTEM_AUTOPILOT':p.actor.user}))).filter(x=>madridTime(x.at).date===local.date);
    const liveActivation=this.config.mode==='LIVE'&&consolidatedPolicy(this.config)?await this.ledger.liveActivation(this.engine.accountId,this.config.approved.approvalReference):null;
    return {version:AUTOPILOT_VERSION,mode:this.config.mode,enabled:this.config.enabled,liveEnabled:this.config.mode==='LIVE'&&this.config.liveCompiled,writesEnabled:this.config.writesEnabled,liveCompiled:this.config.liveCompiled,liveActivation,policy:this.config.policy,approved:this.config.approved,legacyLimits:this.config.legacy,
      date:local.date,timezone:'Europe/Madrid',observedAt:evidence.snapshot.observedAt,nextReviewAt:nextAt,lastExecutionAt:slots.find(s=>s.completed_at)?.completed_at||null,reviewTimes:REVIEW_TIMES,campaigns,timeline,slots,inventory:evidence.inventory.campaigns.map(c=>({campaignId:String(c.id),name:c.name,status:c.effective_status})),
      constraints:evidence.constraints,accountSpend:evidence.inventory.accountSpend,alerts:[...interrupted.map(s=>({code:'INTERRUPTED_REVIEW_REQUIRED',slot:s.slot_key})),...slots.filter(s=>s.state==='FAILED').map(s=>({code:s.body?.code||'AUTOPILOT_REVIEW_FAILED',slot:s.slot_key})),...slots.filter(s=>s.body?.finalCheck?.state==='CRITICAL_UNVERIFIED_CAP').map(s=>({code:'CRITICAL_UNVERIFIED_CAP',slot:s.slot_key})),...(evidence.inventory.accountSpend?.spendCents>=this.config.approved.globalSpendLimitCents&&this.config.approved.globalSpendLimitCents?[{code:'ACCOUNT_SPEND_LIMIT_REACHED',slot:local.date}]:[])],
      policyConflicts:[...(!consolidatedPolicy(this.config)?['MAX_CHANGE_PERCENT','CAMPAIGN_COOLDOWN']:[]),...(!this.config.approved.minimumBudgetCents?['OPERATING_MINIMUM_NOT_APPROVED']:[]),...(!this.config.approved.globalSpendLimitCents&&this.config.approved.globalSpendLimitMode!=='UNLIMITED_AUTHORIZED'?['GLOBAL_SPEND_LIMIT_NOT_APPROVED']:[]),...(!this.config.approved.incrementalPurchases?['INCREMENTAL_POLICY_NOT_APPROVED']:[])],externalWrites:0};
  }
  async audit(query={}){return this.ledger.autopilotAudit(this.engine.accountId,query);}
}
