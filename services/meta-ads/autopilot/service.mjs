import {AUTOPILOT_VERSION,evaluateAutopilot,nightTarget,autopilotMetric,consolidatedPolicy} from './policy.mjs';
import {reviewSlot,nextReview,madridTime,reviewTimes,instantFor} from './schedule.mjs';
import {isV6,intradayTrend,rankV6} from './v6-policy.mjs';
import {budgetDiagnostic} from './errors.mjs';

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
  async constraints({validate=false}={}) {
    // Coalesce concurrent reads only. Each new capture/revalidation still gets
    // fresh provider constraints; a failed read is never cached as verified.
    const key=validate?'validationTask':'constraintsTask';
    if(!this[key])this[key]=this.readFreshConstraints({validate}).finally(()=>{this[key]=null;});
    return this[key];
  }
  async readFreshConstraints({validate=false}={}) {
    if(this.readConstraints)return this.readConstraints();
    try {
      const rows=isV6(this.config)?[]:await this.engine.reader.readMinimumBudgets();
      const perCampaign={};
      const persisted=isV6(this.config)&&this.ledger.minimumReceipts?await this.ledger.minimumReceipts(this.engine.accountId,this.now()):[];
      for(const row of [...(this.config.verifiedMinimums||[]),...persisted,...this.minimumReceipts.values()])if(row.accountId===this.engine.accountId&&Date.parse(row.verifiedAt)<=this.now()&&Date.parse(row.validUntil)>this.now())perCampaign[row.campaignId]={...row,verified:true};
      if((validate||!isV6(this.config))&&this.config.mode==='LIVE'&&consolidatedPolicy(this.config)&&this.engine.writer?.validateDailyBudget){
        const campaigns=await this.engine.reader.readCampaigns();
        for(const c of campaigns.filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE'&&Number.isSafeInteger(Number(c.daily_budget))&&Number(c.daily_budget)>0)){
          if(perCampaign[String(c.id)]?.minimumCents>=this.config.approved.minimumBudgetCents)continue;
          try {
            await this.engine.writer.validateDailyBudget(String(c.id),this.config.approved.minimumBudgetCents,{expectedBefore:Number(c.daily_budget)});
            const at=this.now(),receipt={accountId:this.engine.accountId,campaignId:String(c.id),currency:'EUR',minimumCents:this.config.approved.minimumBudgetCents,reference:this.config.approved.approvalReference,verifiedAt:new Date(at).toISOString(),validUntil:new Date(at+86400000).toISOString()};
            if(isV6(this.config)&&this.ledger.saveMinimumReceipt)await this.ledger.saveMinimumReceipt(receipt);
            this.minimumReceipts.set(String(c.id),receipt);perCampaign[String(c.id)]={...receipt,verified:true};
          } catch(error) {perCampaign[String(c.id)]={verified:false,reason:'META_MINIMUM_VALIDATION_UNAVAILABLE',diagnostic:budgetDiagnostic(error,{stage:'MINIMUM_VALIDATION',campaignId:String(c.id)})};if(error.code==='META_RATE_LIMITED')break;}
        }
      }
      // The account endpoint publishes different billing/optimization categories.
      // Taking their maximum as every campaign's minimum would invent a mapping.
      return {verified:false,minimumCents:null,perCampaign,accountMinimums:rows.filter(r=>r.currency==='EUR'),scope:'ACCOUNT_CATEGORIES_REQUIRE_CAMPAIGN_VERIFICATION',observedAt:new Date(this.now()).toISOString()};
    } catch {return {verified:false,minimumCents:null,reason:'META_MINIMUM_UNAVAILABLE'};}
  }
  async capture({learningWaitMs=this.learningWaitMs,slot=null,validateMinimums=false}={}) {
    const at=this.now(),date=madridTime(at).date;
    const v6=isV6(this.config),night=v6&&slot?.kind==='NIGHT';
    const [inventory,snapshot,history,constraints,baseline,slots,reservations]=await Promise.all([this.engine.inventory({financialOnly:night}),night?Promise.resolve({facts:[],range:{since:date,until:date},observedAt:new Date(at).toISOString()}):this.engine.snapshot('hoy','campaign',{persist:false}),this.ledger.autopilotHistory(this.engine.accountId,at),this.constraints({validate:validateMinimums}),v6&&this.ledger.autopilotBaseline?this.ledger.autopilotBaseline(this.engine.accountId,date):null,v6?this.ledger.autopilotSlots(this.engine.accountId,at):[],v6&&this.ledger.nightReservations?this.ledger.nightReservations(this.engine.accountId,date):[]]);
    if(madridTime(this.now()).date!==date||snapshot.range.since!==date)throw Error('AUTOPILOT_DAY_CHANGED');
    snapshot.facts=snapshot.facts.map(autopilotMetric);
    const learning=new Map();
    if(!night&&this.engine.learningAssessment)await Promise.all(inventory.campaigns.filter(c=>c.effective_status==='ACTIVE').map(async c=>{learning.set(String(c.id),await this.learningAssessment(c,{waitMs:learningWaitMs}));}));
    return {inventory,snapshot,history,constraints,baseline,slots,reservations,at,learning};
  }
  decisions(evidence,slot) {
    const metrics=new Map(evidence.snapshot.facts.map(f=>[f.campaignId,f]));
    const decisions=evidence.inventory.campaigns.filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE').map(c=>{
      const metric=metrics.get(String(c.id)),previous=(evidence.slots||[]).filter(s=>s.state==='COMPLETE'&&s.body?.version===this.config.policy.version&&Date.parse(s.created_at)<this.now()).flatMap(s=>(s.body.decisions||[]).filter(d=>d.campaignId===String(c.id)).map(d=>d.metric)).find(Boolean);
      const d=evaluateAutopilot({campaign:c,metric,slot,now:this.now(),config:this.config,history:evidence.history,constraints:evidence.constraints,accountSpend:evidence.inventory.accountSpend,baseline:evidence.baseline,trend:intradayTrend(metric,previous,this.now())});
      if(isV6(this.config)){
        if(slot.kind==='NIGHT'&&(evidence.reservations||[]).some(r=>r.campaign_id===String(c.id)))d.reasons.push('NIGHT_ALREADY_CLAIMED');
        const context=evidence.learning?.get(String(c.id)),score=r=>Number.isFinite(r)?Math.max(0,Math.min(1,r/6)):null;
        d.ranking=rankV6({today:score(metric?.metaRoas),recent:score(context?.recent?.roas),historical:score(context?.historical?.roas)});
        d.sourceDiagnostics=context?.sourceDiagnostics||null;
      }
      return d;
    });
    const intent={mode:'scheduled',targets:Object.fromEntries(decisions.map(d=>[d.campaignId,d.after]))};
    for(const d of decisions)if(d.action!=='HOLD'){
      const campaign=evidence.inventory.campaigns.find(c=>String(c.id)===d.campaignId);
      d.reasons.push(...this.engine.policyReasons(campaign,d.metric,intent,evidence.inventory).reasons,...(isV6(this.config)&&slot.kind==='NIGHT'?[]:evidence.learning?.get(d.campaignId)?.reasons||[]));
    }
    const sumBefore=decisions.reduce((sum,d)=>sum+(Number.isSafeInteger(d.before)?d.before:0),0);
    if(decisions.some(d=>!Number.isSafeInteger(d.before)||d.before<=0))for(const d of decisions)if(d.after>d.before)d.reasons.push('GLOBAL_EXPOSURE_UNVERIFIED');
    const proposed=sumBefore+decisions.filter(d=>!d.reasons.length).reduce((sum,d)=>sum+Math.max(0,d.after-d.before),0);
    if(!isV6(this.config)&&this.config.approved.globalExposureCents&&proposed>this.config.approved.globalExposureCents)for(const d of decisions)if(d.after>d.before){d.reasons.push('GLOBAL_EXPOSURE_LIMIT');d.state='BLOCKED';}
    const previousIncrease=evidence.history.filter(p=>madridTime(p.createdAt).date===madridTime(this.now()).date).reduce((sum,p)=>sum+p.items.filter(i=>['VERIFIED','RECONCILED','EXECUTING','UNKNOWN'].includes(i.result?.state)||(p.mode===this.config.mode&&i.result?.state==='SIMULATED')).reduce((s,i)=>s+Math.max(0,i.after-i.before),0),0);
    const newIncrease=decisions.filter(d=>!d.reasons.length).reduce((s,d)=>s+Math.max(0,d.after-d.before),0);
    if(isV6(this.config)){
      let used=previousIncrease,exposure=sumBefore;
      for(const d of decisions.toSorted((a,b)=>(b.ranking?.score??-1)-(a.ranking?.score??-1)||a.campaignId.localeCompare(b.campaignId)))if(!d.reasons.length&&d.after>d.before){
        const delta=d.after-d.before;
        if(!Number.isSafeInteger(this.config.legacy.maxAggregateIncreaseCents)||used+delta>this.config.legacy.maxAggregateIncreaseCents)d.reasons.push('AGGREGATE_DAILY_LIMIT');
        else if(exposure+delta>this.config.approved.globalExposureCents)d.reasons.push('GLOBAL_EXPOSURE_LIMIT');
        else{used+=delta;exposure+=delta;}
      }
      decisions.sort((a,b)=>(b.ranking?.score??-1)-(a.ranking?.score??-1)||a.campaignId.localeCompare(b.campaignId));
    }else if(!Number.isSafeInteger(this.config.legacy.maxAggregateIncreaseCents)||previousIncrease+newIncrease>this.config.legacy.maxAggregateIncreaseCents)for(const d of decisions)if(d.after>d.before)d.reasons.push('AGGREGATE_DAILY_LIMIT');
    for(const d of decisions){d.reasons=[...new Set(d.reasons)];if(d.reasons.length)d.state='BLOCKED';}
    return decisions;
  }
  async validate(campaign,metric,proposal,{inventory:capturedInventory}={}) {
    const claimed=proposal.autopilot.slot,start=instantFor(claimed.date,claimed.time);
    const slot=isV6(this.config)&&this.now()>=start&&this.now()<start+300000?claimed:reviewSlot(this.now(),this.config.policy.version);
    if(!slot||slot.key!==proposal.autopilot.slot.key)return {after:null,reasons:['AUTOPILOT_SLOT_EXPIRED']};
    const date=madridTime(this.now()).date,v6=isV6(this.config);
    const [history,constraints,inventory,baseline,slots,reservations]=await Promise.all([this.ledger.autopilotHistory(this.engine.accountId,this.now()),this.constraints({validate:true}),capturedInventory||this.engine.inventory({financialOnly:v6&&slot.kind==='NIGHT'}),v6&&this.ledger.autopilotBaseline?this.ledger.autopilotBaseline(this.engine.accountId,date):null,v6?this.ledger.autopilotSlots(this.engine.accountId,this.now()):[],v6&&this.ledger.nightReservations?this.ledger.nightReservations(this.engine.accountId,date):[]]);
    const evidence={snapshot:{facts:metric?[metric]:[]},history,constraints,inventory,baseline,slots,reservations};
    const current=this.decisions(evidence,slot).find(d=>d.campaignId===String(campaign.id));
    return current||{after:null,reasons:['CAMPAIGN_MISSING']};
  }
  async manualAssessment(campaign,after,{constraints:capturedConstraints}={}) {
    const constraints=capturedConstraints===undefined?await this.constraints({validate:true}):capturedConstraints,minimum=constraints?.perCampaign?constraints.perCampaign[String(campaign.id)]:constraints,reasons=[];
    if(this.config.approved.authorizationExpiresAt&&Date.parse(this.config.approved.authorizationExpiresAt)<=this.now())reasons.push('AUTOPILOT_AUTHORIZATION_EXPIRED');
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
    const slot=reviewSlot(this.now(),this.config.policy.version);if(!slot){
      // Warm the existing coalesced GET-only evidence task shortly before the
      // next review, so a cold history read does not consume its one-minute slot.
      const until=Date.parse(nextReview(this.now(),this.config.policy.version))-this.now();
      if(isV6(this.config)&&until>0&&until<=45000)this.engine.reader.reserveFinancialWindow?.(this.now()+180000);
      if(until>0&&until<=45000&&(!isV6(this.config)||reviewSlot(Date.parse(nextReview(this.now(),this.config.policy.version)),this.config.policy.version)?.kind!=='NIGHT')&&this.engine.prepareBudgetEvidence&&!this.warming){
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
        if(isV6(this.config))this.engine.reader.reserveFinancialWindow?.(this.now()+180000);
        const evidence=await this.capture({learningWaitMs:consolidatedPolicy(this.config)?20000:this.learningWaitMs,slot,validateMinimums:slot.kind!=='OBSERVE'});
        if(reviewSlot(this.now(),this.config.policy.version)?.key!==slot.key&&!(isV6(this.config)&&this.now()<instantFor(slot.date,slot.time)+300000&&madridTime(this.now()).date===slot.date))throw Error('AUTOPILOT_SLOT_EXPIRED');
        const decisions=this.decisions(evidence,slot);
        if(isV6(this.config)&&slot.kind==='OBSERVE'){
          const budgets=Object.fromEntries(evidence.inventory.campaigns.filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE').map(c=>[String(c.id),Number(c.daily_budget)]));
          const baseline={date:slot.date,verified:Object.values(budgets).every(b=>Number.isSafeInteger(b)&&b>0),budgets,observedAt:evidence.snapshot.observedAt};
          const body={version:this.config.policy.version,slot,mode:this.config.mode,baseline,decisions,externalWrites:0,executionState:'OBSERVED_NO_RESTORE',completedAt:this.now()};
          await this.ledger.finishAutopilotSlot(this.engine.accountId,slot.key,'COMPLETE',body);return body;
        }
        const proposal=await this.engine.proposeScheduled({slot,decisions,evidence,config:this.config});
        proposalId=proposal.id;
        const result=await this.engine.confirmScheduled(proposal.id);
        const outcomes=result.items.map(i=>({campaignId:i.campaignId,state:i.result?.state||'UNKNOWN',reasons:i.result?.reasons||i.reasons}));
        const hasUnknown=outcomes.some(i=>['UNKNOWN','EXECUTING'].includes(i.state));
        const body={version:this.config.policy.version,slot,proposalId:result.id,mode:this.config.mode,externalWrites:hasUnknown?null:result.items.reduce((s,i)=>s+(i.result?.externalWrites||0),0),completedAt:this.now(),decisions,outcomes,
          executionState:hasUnknown?'UNKNOWN_RESULT':outcomes.length>0&&outcomes.every(i=>i.state==='VERIFIED')?'VERIFIED':outcomes.some(i=>i.state==='VERIFIED')?'PARTIAL_FAILURE':this.config.mode==='LIVE'?'BLOCKED':'SIMULATED',minimumReceipts:evidence.constraints?.perCampaign||{}};
        if(isV6(this.config)&&slot.kind==='NIGHT')body.nightSummary={eligible:decisions.filter(d=>d.action!=='HOLD'&&!d.reasons.length).length,processed:result.items.filter(i=>i.result?.before!==undefined).length,verified:outcomes.filter(i=>i.state==='VERIFIED').length,blocked:outcomes.filter(i=>['BLOCKED','STALE'].includes(i.state)).length,held:decisions.filter(d=>d.action==='HOLD').length,incidents:outcomes.filter(i=>['UNKNOWN','EXECUTING','FAILED'].includes(i.state)).length,finalState:body.executionState,details:result.items.map(i=>({campaignId:i.campaignId,before:i.before,after:i.after,state:i.result?.state,effectiveReductionBps:i.result?.effectiveReductionBps??null,readback:i.result?.readback||null,diagnostic:i.result?.diagnostic||null}))};
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
      } catch(error) {
        const body={version:this.config.policy.version,slot,proposalId,code:slot.time==='23:59'?'CRITICAL_UNVERIFIED_CAP':'AUTOPILOT_REVIEW_FAILED',diagnostic:budgetDiagnostic(error,{stage:'REVIEW'}),externalWrites:this.config.mode==='LIVE'?null:0};
        await this.ledger.finishAutopilotSlot(this.engine.accountId,slot.key,'FAILED',body);
        return {state:'FAILED',...body};
      }
    } finally {this.busy=false;}
  }
  async overview() {
    const evidence=await this.capture(),at=this.now(),local=madridTime(at);
    const slots=await this.ledger.autopilotSlots(this.engine.accountId,at);
    const nextAt=nextReview(at,this.config.policy.version),hypothetical=reviewSlot(Date.parse(nextAt),this.config.policy.version);
    const interrupted=slots.filter(s=>s.state==='EXECUTING'&&at-Date.parse(s.created_at)>300000);
    const campaigns=this.decisions(evidence,hypothetical);
    const timeline=evidence.history.flatMap(p=>p.items.map(i=>({at:i.result?.verifiedAt||p.createdAt,operationId:p.id+':'+i.campaignId,campaignId:i.campaignId,name:i.name,before:i.before,after:i.after,mode:p.mode,origin:p.origin||'MANUAL',state:i.result?.state||p.state,actor:p.origin==='AUTOPILOT'?'SYSTEM_AUTOPILOT':p.actor.user,readback:i.result?.readback||null,diagnostic:i.result?.diagnostic||null}))).filter(x=>madridTime(x.at).date===local.date);
    const liveActivation=this.config.mode==='LIVE'&&consolidatedPolicy(this.config)?await this.ledger.liveActivation(this.engine.accountId,this.config.approved.approvalReference):null;
    return {version:this.config.policy.version,mode:this.config.mode,enabled:this.config.enabled,liveEnabled:this.config.mode==='LIVE'&&this.config.liveCompiled,writesEnabled:this.config.writesEnabled,liveCompiled:this.config.liveCompiled,liveActivation,policy:this.config.policy,approved:this.config.approved,legacyLimits:this.config.legacy,quota:this.engine.reader.requestStats?.()||null,
      date:local.date,timezone:'Europe/Madrid',observedAt:evidence.snapshot.observedAt,nextReviewAt:nextAt,lastExecutionAt:slots.find(s=>s.completed_at)?.completed_at||null,reviewTimes:reviewTimes(this.config.policy.version),campaigns,timeline,slots,inventory:evidence.inventory.campaigns.map(c=>({campaignId:String(c.id),name:c.name,status:c.effective_status})),
      constraints:evidence.constraints,accountSpend:evidence.inventory.accountSpend,limitations:isV6(this.config)?['Las compras nuevas posteriores al cambio necesitan procedencia y hora de conversión verificadas; el contador agregado no basta.','La comparación con ayer a la misma hora no está acreditada.','El historial largo no se vuelve a solicitar en la ventana financiera; el ranking muestra la cobertura disponible.']:[],alerts:[...interrupted.map(s=>({code:'INTERRUPTED_REVIEW_REQUIRED',slot:s.slot_key})),...slots.filter(s=>s.state==='FAILED').map(s=>({code:s.body?.code||'AUTOPILOT_REVIEW_FAILED',slot:s.slot_key,diagnostic:s.body?.diagnostic||null})),...slots.filter(s=>s.body?.finalCheck?.state==='CRITICAL_UNVERIFIED_CAP').map(s=>({code:'CRITICAL_UNVERIFIED_CAP',slot:s.slot_key})),...(evidence.inventory.accountSpend?.spendCents>=this.config.approved.globalSpendLimitCents&&this.config.approved.globalSpendLimitCents?[{code:'ACCOUNT_SPEND_LIMIT_REACHED',slot:local.date}]:[])],
      policyConflicts:[...(!consolidatedPolicy(this.config)?['MAX_CHANGE_PERCENT','CAMPAIGN_COOLDOWN']:[]),...(!this.config.approved.minimumBudgetCents?['OPERATING_MINIMUM_NOT_APPROVED']:[]),...(!this.config.approved.globalSpendLimitCents&&this.config.approved.globalSpendLimitMode!=='UNLIMITED_AUTHORIZED'?['GLOBAL_SPEND_LIMIT_NOT_APPROVED']:[]),...(!this.config.approved.incrementalPurchases?['INCREMENTAL_POLICY_NOT_APPROVED']:[])],externalWrites:0};
  }
  async audit(query={}){return this.ledger.autopilotAudit(this.engine.accountId,query);}
}
