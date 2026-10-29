import {EVENT,TEMPLATE,POLICY,classify,digest,claimKey,addressOf,addressEquals,candidateConfidence,sourceInvariant,verifySource,verifyImport,safeCode,normalizeId} from './policy.mjs';

// Not imported by, called by, or registered with the normal importer.
// All ports are injected; SHADOW deliberately calls none of them.
export class AddressRecoveryAgent {
  constructor({store,config,ports={},now=Date.now}){this.store=store;this.config=config;this.ports=ports;this.now=now;}
  ingest(event){
    if(!this.config.enabled)return {ignored:'DISABLED'};
    const classification=classify(event);
    if(!classification)return {ignored:'NO_PERSISTED_IMPORT_FAILURE'};
    const result=this.store.ingest(event,classification);
    return {id:result.case.id,created:result.created,state:result.case.state,blocked:result.blocked};
  }
  current(c){const latest=this.store.get(c.id);if(latest?.version!==c.version||latest.resolvedAt)throw Error('RECOVERY_CASE_CHANGED');}
  step(c,state,nextAction,reason=state){this.current(c);c.state=state;c.nextAction=nextAction;this.store.save(c,{reason});return c;}
  manual(c,reason){c.lastError=safeCode(reason);return this.step(c,c.state,'MANUAL_REVIEW',reason);}
  async exact(c){
    this.current(c);
    const r=await this.ports.dropea.findExact({shop:c.private.shop,storeId:c.private.storeId,externalReference:c.private.externalReference});
    if(r?.complete!==true||!Array.isArray(r.items)||String(r.storeId)!==String(c.private.storeId)||r.externalReference!==c.private.externalReference||
       !Number.isFinite(Date.parse(r.observedAt))||Math.abs(this.now()-Date.parse(r.observedAt))>120_000||
       r.items.some(o=>!o.id||String(o.storeId)!==String(c.private.storeId)||o.externalReference!==c.private.externalReference))throw Error('EXACT_REFERENCE_UNVERIFIABLE');
    return r.items;
  }
  async existing(c){
    const rows=await this.exact(c);
    if(rows.length>1){this.manual(c,'DUPLICATE_EXTERNAL_REFERENCE');return true;}
    if(rows.length===1){
      c.dropeaOrderId=String(rows[0].id);c.dropeaImportStatus='ALREADY_IMPORTED';
      // Do not invent that the existing order is healthy or change its incidents.
      c.private.existingAddressReview=rows[0].addressProblem===true?'PRESENT':rows[0].addressProblem===false?'ABSENT':'NOT_VERIFIABLE';
      // A source-only recovery can be completed by the unchanged native/existing
      // importer. Count recovery only after independent full postconditions.
      const verified=c.shopifyCorrectionStatus==='VERIFIED'&&rows[0].sourcePostconditionsVerified===true;
      if(verified)c.dropeaImportStatus='VERIFIED';
      c.resolvedAt=new Date(this.now()).toISOString();
      // step checks the persisted version, not the updated in-memory resolvedAt.
      this.step(c,verified?'IMPORT_VERIFIED':'ALREADY_IMPORTED',verified?'END':'VERIFY_EXISTING_ADDRESS');return true;
    }
    return false;
  }
  async source(c){
    this.current(c);
    const o=await this.ports.shopify.readOrder(c.shopifyOrderId,c.private.shop);
    if(!verifySource(o,c))throw Error('SOURCE_CHANGED_OR_INELIGIBLE');
    return o;
  }
  async process(id){
    if(!this.config.enabled)return {ignored:'DISABLED'};
    let c=this.store.get(id);
    if(!c||c.failureClass!=='ADDRESS'||c.resolvedAt)return {ignored:'NO_ACTIVE_ADDRESS_CASE'};
    if(this.config.shadow)return {id,state:c.state,mode:'SHADOW',externalActions:0};
    const lease=this.store.lease(c.shopifyOrderId);if(!lease)return {id,blocked:'CASE_BUSY'};
    try{
      c=this.store.get(id);
      if(c.resolvedAt)return {id,state:c.state};
      // An import already dispatched is only ever reconciled, never replayed.
      if(this.store.effect(claimKey(c.shopifyOrderId)))return await this.reconcileImport(c);
      if(c.private.newFailurePending)return this.manual(c,'NEW_FAILURE_REQUIRES_RECLASSIFICATION');
      if(await this.existing(c))return {id,state:c.state};
      if(c.category==='NO_CARRIER_FOR_ADDRESS'&&!this.config.validateCoverage)return this.manual(c,'CARRIER_COVERAGE_REVIEW');
      if(c.nextAction==='MANUAL_REVIEW'&&!(this.config.validateCoverage&&c.lastError==='CARRIER_COVERAGE_REVIEW'))return {id,state:c.state,blocked:c.lastError};
      const order=await this.source(c);
      if(!c.private.invariant){c.private.invariant=sourceInvariant(order);c.private.originalAddress=addressOf(order);c.private.originalContact=contact(order);this.step(c,'VALIDATING','VALIDATE_FAILED_ORDER');}
      if(c.shopifyCorrectionStatus==='VERIFIED'){
        if(!addressEquals(addressOf(order),c.private.candidate))return this.manual(c,'SOURCE_ADDRESS_CHANGED');
        return await this.reimport(c,order);
      }
      const addressEffect=this.store.effect(`SHOPIFY_ADDRESS_RECOVERY:${c.shopifyOrderId}:${c.failureGeneration}`);
      if(addressEffect&&c.private.candidate)return await this.correct(c,order,c.private.candidate,c.customerConfirmationStatus==='VERIFIED');
      if(c.customerConfirmationStatus==='SENT'||c.state==='WAITING_CUSTOMER')return await this.customerReply(c,order);
      const result=await this.ports.address.findCandidates(addressOf(order),{caseId:c.id,shopifyOrderId:c.shopifyOrderId});
      const confidence=candidateConfidence(result,addressOf(order));
      c.confidence=confidence.score;c.confidenceLevel=confidence.level;c.private.candidate=confidence.candidate;
      c.private.validationEvidence=result?.evidenceId||null;
      c.private.validationReceipt=result?.receipt||null;
      this.store.save(c,{reason:'ADDRESS_CANDIDATE_CLASSIFIED'});
      if(c.category==='NO_CARRIER_FOR_ADDRESS'&&(confidence.level!=='HIGH'||addressEquals(confidence.candidate,addressOf(order))))return this.manual(c,'CARRIER_COVERAGE_REVIEW');
      if(confidence.level!=='HIGH'||addressEquals(confidence.candidate,addressOf(order))||
         c.failureCode==='ADDRESS_LINES_TOO_LONG' && (confidence.candidate.street.length+(confidence.candidate.line2||'').length)>100)return await this.waitCustomer(c,order);
      return await this.correct(c,order,confidence.candidate,false);
    }catch(error){
      // Never expose provider bodies or customer text in logs, API, or audit.
      const fresh=this.store.get(id);
      if(fresh&&!fresh.resolvedAt){fresh.lastError=safeCode(error.code||error.message);fresh.nextAction='MANUAL_REVIEW';this.store.save(fresh,{reason:fresh.lastError});}
      return {id,blocked:safeCode(error.code||error.message)};
    }finally{this.store.release(c.shopifyOrderId,lease);}
  }
  async correct(c,order,candidate,customer){
    if(!this.config.shopifyWrite)return this.step(c,c.state,'ENABLE_SHOPIFY_WRITE');
    if(await this.existing(c))return c;
    const fresh=await this.source(c);
    const key=`SHOPIFY_ADDRESS_RECOVERY:${c.shopifyOrderId}:${c.failureGeneration}`;
    const previous=this.store.effect(key);
    if(previous){
      // A crash/timeout after Shopify dispatch is resolved with GET only.
      if(addressEquals(addressOf(fresh),candidate)&&digest(contact(fresh))===digest(c.private.originalContact)){
        this.store.finish(key,'VERIFIED');c.shopifyCorrectionStatus='VERIFIED';
        this.step(c,customer?'VERIFIED_ADDRESS':'AUTO_CORRECTED','REIMPORT_PENDING');return this.reimport(c,fresh);
      }
      c.shopifyCorrectionStatus='UNKNOWN';return this.manual(c,'SHOPIFY_WRITE_UNCERTAIN');
    }
    if(!addressEquals(addressOf(fresh),c.private.originalAddress))return this.manual(c,'SOURCE_ADDRESS_CHANGED');
    if(customer){const chat=await this.conversation(c);if(chat.latestRelevantMessageId!==c.private.acceptedMessageId) return this.manual(c,'LATER_CUSTOMER_MESSAGE');}
    // The write port accepts only a shipping address; no customer/profile API.
    if(!this.store.claim(key,c,'SHOPIFY_SHIPPING_ADDRESS'))throw Error('ADDRESS_WRITE_ALREADY_CLAIMED');
    c.private.candidate=candidate;c.shopifyCorrectionStatus='CLAIMED';this.store.save(c,{reason:'SHIPPING_ADDRESS_WRITE_CLAIMED'});
    try{
      this.current(c);
      await this.ports.shopify.updateShippingAddress(c.shopifyOrderId,c.private.shop,candidate);
      const after=await this.source(c);
      if(!addressEquals(addressOf(after),candidate))throw Error('SHOPIFY_ADDRESS_POSTCONDITION_FAILED');
      // Name/phone are part of shipping_address: preserve them too.
      if(digest(contact(after))!==digest(contact(fresh)))throw Error('SHOPIFY_CONTACT_POSTCONDITION_FAILED');
      this.store.finish(key,'VERIFIED');c.shopifyCorrectionStatus='VERIFIED';
      this.step(c,customer?'VERIFIED_ADDRESS':'AUTO_CORRECTED','REIMPORT_PENDING');
    }catch(error){this.store.finish(key,'UNKNOWN');c.shopifyCorrectionStatus='UNKNOWN';c.lastError=safeCode(error.code||error.message);return this.step(c,c.state,'RECONCILE_BEFORE_RETRY','SHOPIFY_WRITE_UNCERTAIN');}
    return this.reimport(c,await this.source(c));
  }
  async conversation(c){
    const p=await this.ports.chatby.orderConversation({shopifyOrderId:c.shopifyOrderId,shop:c.private.shop,externalReference:c.private.externalReference});
    if(p?.verified!==true||p.orderScoped!==true||normalizeId(p.shopifyOrderId)!==c.shopifyOrderId||p.shop!==c.private.shop||
       p.externalReference!==c.private.externalReference||!p.conversationId||!Number.isFinite(Date.parse(p.observedAt))||
       Math.abs(this.now()-Date.parse(p.observedAt))>120_000||p.currentOrderCancelled===true)throw Error('ORDER_CONVERSATION_UNVERIFIABLE');
    return p;
  }
  async waitCustomer(c){
    c.customerConfirmationStatus='REQUIRED';this.step(c,'WAITING_CUSTOMER','WAITING_CUSTOMER_ADDRESS');
    if(!this.config.chatbySend)return this.step(c,'WAITING_CUSTOMER','VERIFY_CURRENT_ORDER_CONTACT');
    if(await this.existing(c))return c;
    const conversation=await this.conversation(c),key=`CHATBY_ADDRESS_RECOVERY:${c.shopifyOrderId}:${TEMPLATE}`;
    if(this.store.effect(key))return this.manual(c,'TEMPLATE_DELIVERY_RECONCILIATION_REQUIRED');
    // Adapter must reserve the EXISTING shared template ledger for this exact order.
    const shared=await this.ports.chatby.reserveTemplate({shopifyOrderId:c.shopifyOrderId,template:TEMPLATE,conversationId:conversation.conversationId});
    if(!shared?.acquired||!shared.persistent)return this.manual(c,'TEMPLATE_ALREADY_SENT_OR_UNCERTAIN');
    if(!this.store.claim(key,c,'CHATBY_TEMPLATE'))return this.manual(c,'TEMPLATE_ALREADY_CLAIMED');
    try{
      const fresh=await this.conversation(c);
      if(fresh.conversationId!==conversation.conversationId)throw Error('ORDER_CONVERSATION_CHANGED');
      this.current(c);
      const result=await this.ports.chatby.sendTemplate({shopifyOrderId:c.shopifyOrderId,conversationId:fresh.conversationId,template:TEMPLATE,key});
      if(result?.verified!==true||!result.messageId)throw Error('TEMPLATE_DELIVERY_UNCERTAIN');
      this.store.finish(key,'VERIFIED');c.customerConfirmationStatus='SENT';c.private.requestMessageId=result.messageId;
      c.private.conversationId=fresh.conversationId;c.private.requestedAt=new Date(this.now()).toISOString();
      return this.step(c,'WAITING_CUSTOMER','WAITING_CUSTOMER_ADDRESS','TEMPLATE_DELIVERED_VERIFIED');
    }catch{this.store.finish(key,'UNKNOWN');return this.manual(c,'TEMPLATE_DELIVERY_UNCERTAIN');}
  }
  async customerReply(c,order){
    if(c.customerConfirmationStatus!=='SENT')return this.config.chatbySend?this.waitCustomer(c,order):c;
    const conversation=await this.conversation(c),reply=conversation.latestCustomerAddress;
    if(!reply)return c;
    if(conversation.conversationId!==c.private.conversationId||reply.author!=='CUSTOMER'||reply.complete!==true||
       !reply.messageId||!Number.isFinite(Date.parse(reply.at))||Date.parse(reply.at)<=Date.parse(c.private.requestedAt)||
       reply.superseded===true||reply.cancelled===true||reply.messageId!==conversation.latestRelevantMessageId)return this.manual(c,'CUSTOMER_ADDRESS_AMBIGUOUS');
    this.step(c,'CUSTOMER_ADDRESS_RECEIVED','VALIDATE_CUSTOMER_ADDRESS');
    const result=await this.ports.address.findCandidates(reply.address,{caseId:c.id,shopifyOrderId:c.shopifyOrderId});
    const confidence=candidateConfidence(result,reply.address,{customer:true});
    c.confidence=confidence.score;c.confidenceLevel=confidence.level;c.private.candidate=confidence.candidate;
    c.private.validationEvidence=result?.evidenceId||null;this.store.save(c,{reason:'CUSTOMER_ADDRESS_VALIDATED'});
    if(confidence.level!=='HIGH')return this.manual(c,'CUSTOMER_ADDRESS_NOT_UNIQUE');
    const latest=await this.conversation(c);
    if(latest.latestRelevantMessageId!==reply.messageId)return this.manual(c,'LATER_CUSTOMER_MESSAGE');
    c.customerConfirmationStatus='VERIFIED';c.private.acceptedMessageId=reply.messageId;this.store.save(c,{reason:'CUSTOMER_ADDRESS_CONFIRMED'});
    return this.correct(c,order,confidence.candidate,true);
  }
  async reimport(c,order){
    this.step(c,'REIMPORT_PENDING',this.config.dropeaImport?'REIMPORT_EXACT_ORDER':'ENABLE_DROPEA_IMPORT');
    if(!this.config.dropeaImport)return c;
    if(c.shopifyCorrectionStatus!=='VERIFIED')return this.manual(c,'VERIFIED_CORRECTION_REQUIRED');
    if(await this.existing(c))return c;
    const fresh=await this.source(c);
    if(!addressEquals(addressOf(fresh),c.private.candidate))return this.manual(c,'SOURCE_ADDRESS_CHANGED');
    const prepared=await this.ports.dropea.prepare(fresh);
    // Reuse the established, stock/price/payment-safe builder. Do not implement
    // another looser order builder or alter normal import policies.
    if(!prepared?.eligible||prepared.sourceDigest!==digest(fresh)||prepared.expected?.externalReference!==c.private.externalReference||
       String(prepared.expected?.storeId)!==String(c.private.storeId)||prepared.expected?.currency!==fresh.currency||
       prepared.expected?.totalCents!==Math.round(Number(fresh.total_price)*100)||!addressEquals(prepared.expected?.address||{},addressOf(fresh)))return this.manual(c,'IMPORT_PLAN_NOT_VERIFIED');
    const key=claimKey(c.shopifyOrderId);
    if(!this.store.claim(key,c,'DROPEA_IMPORT'))return this.reconcileImport(c);
    c.private.expected=prepared.expected;c.dropeaImportStatus='CLAIMED';this.store.save(c,{reason:'RECOVERY_IMPORT_CLAIMED'});
    // Coordination with the existing writer's SAME-ORDER reservation is required.
    // A standalone exact-reference GET cannot prevent a concurrent writer race.
    const shared=await this.ports.dropea.reserveExistingImporter({shopifyOrderId:c.shopifyOrderId,plan:prepared,key});
    if(shared?.acquired!==true||shared.persistent!==true||shared.nativeRetryQuiescent!==true){
      this.store.finish(key,'CANCELLED_BEFORE_SEND');return this.manual(c,'EXISTING_IMPORTER_RESERVATION_REQUIRED');
    }
    if(await this.existing(c)){this.store.finish(key,'CANCELLED_BEFORE_SEND');return c;}
    const last=await this.source(c);
    if(digest(last)!==prepared.sourceDigest){this.store.finish(key,'CANCELLED_BEFORE_SEND');return this.manual(c,'SOURCE_CHANGED_BEFORE_IMPORT');}
    if(c.customerConfirmationStatus==='VERIFIED'){
      const chat=await this.conversation(c);
      if(chat.latestRelevantMessageId!==c.private.acceptedMessageId){this.store.finish(key,'CANCELLED_BEFORE_SEND');return this.manual(c,'LATER_CUSTOMER_MESSAGE');}
    }
    this.current(c);
    try{
      await this.ports.dropea.importOnce(prepared,key); // exactly ONE dispatch, no retry wrapper
      return await this.reconcileImport(c);
    }catch(error){
      this.store.finish(key,error.definitive===true?'DEFINITIVE_REJECTED':'UNKNOWN');c.dropeaImportStatus=error.definitive===true?'DEFINITIVE_REJECTED':'UNKNOWN';
      c.lastError=safeCode(error.code||error.message);
      return this.step(c,'REIMPORT_PENDING','RECONCILE_BEFORE_RETRY',c.lastError);
    }
  }
  async reconcileImport(c){
    const effect=this.store.effect(claimKey(c.shopifyOrderId));
    if(effect.case_id!==c.id)return this.manual(c,'PRIOR_GENERATION_IMPORT_CLAIM');
    const rows=await this.exact(c);
    if(rows.length!==1||!c.private.expected||!verifyImport(rows[0],c.private.expected)){
      c.dropeaImportStatus='UNKNOWN';this.store.finish(effect.key,'UNKNOWN');
      return this.step(c,'REIMPORT_PENDING','RECONCILE_BEFORE_RETRY',rows.length>1?'DUPLICATE_EXTERNAL_REFERENCE':'IMPORT_POSTCONDITION_UNVERIFIABLE');
    }
    c.dropeaOrderId=String(rows[0].id);c.dropeaImportStatus='VERIFIED';c.resolvedAt=new Date(this.now()).toISOString();
    this.store.finish(effect.key,'VERIFIED');return this.step(c,'IMPORT_VERIFIED','END');
  }
}
const contact=o=>{const a=o.shipping_address||{};return {name:a.name,firstName:a.first_name,lastName:a.last_name,phone:a.phone,company:a.company};};

export function persistedFailureOnly(event){return event?.type===EVENT && event.persisted===true && event.mappingVersion===POLICY;}
