import {syncChatbyReadOnly} from './integrations/chatby/readonly-sync.mjs';
import {mapDropeaOrderState} from '../packages/platform-core/src/operational-truth/dropea-canonical.mjs';
import {verifiedAbsentOrderPhone} from '../packages/platform-core/src/incident/absent-resolution.mjs';
import {absentSolutionCapability} from './integrations/dropea/absent-solution.mjs';
import {createAbsentResolutionLedger,executeRecipientAbsentResolution} from './recipient-absent-resolution-executor.mjs';

export function createRecipientAbsentResolutionRuntime({pool,projector,clients,writer,chatbyToken,privacyKey,flags,now=()=>new Date(),syncChatby=syncChatbyReadOnly}){
  const ledger=createAbsentResolutionLedger(pool);
  const getClient=issue=>clients.find(x=>x.store.market===issue.market && String(x.store.store_id)===String(issue.store_id))?.client;
  async function readFresh(id){
    const result=await pool.query(`SELECT i.*,o.identity_status FROM read_models.operations_incident_records i
      JOIN read_models.operations_order_records o USING(canonical_order_id) WHERE canonical_issue_id=$1 AND i.type='RECIPIENT_ABSENT'`,[id]);
    const row=result.rows[0];if(!row)throw new Error('EXACT_ORDER_IDENTITY_REQUIRED');
    const client=getClient(row);if(!client)throw new Error('DROPEA_READ_CLIENT_NOT_AVAILABLE');
    let conversation={events:[],chatby:{}};
    const sync=await syncChatby({pool,projector,token:chatbyToken,hmacKey:privacyKey,
      onlyRecipientAbsent:true,onlyCanonicalIssueId:id,maxConversations:1,minRequestIntervalMs:3500,
      // No cached subscriber fields or messages can authorize a real write.
      onAbsentConversation:value=>{conversation=value;}});
    if(!sync.ok || sync.pagination_complete!==true)throw new Error('EXACT_CURRENT_CHATBY_REQUIRED');
    const rawIssue=(await client.request('getIssue',{id:Number(row.dropea_issue_id)})).data;
    const issueAt=new Date(now()).toISOString();
    const rawOrder=(await client.request('getOrder',{id:Number(row.dropea_order_id)})).data;
    const orderAt=new Date(now()).toISOString();
    if(String(rawIssue?.id)!==String(row.dropea_issue_id) || String(rawIssue?.order_id)!==String(row.dropea_order_id)
      || String(rawOrder?.id)!==String(row.dropea_order_id) || String(rawOrder?.store_id)!==String(row.store_id))throw new Error('EXACT_ORDER_IDENTITY_REQUIRED');
    const issue={...row,type:rawIssue.type,status:rawIssue.status,is_active:rawIssue.is_active,carrier:rawIssue.carrier,
      created_at:rawIssue.created_at,updated_at:rawIssue.updated_at,resolution_status:rawIssue.resolution_status,
      resolution_changed_at:rawIssue.resolution_changed_at,allowed_resolution_options:rawIssue.allowed_resolution_options,observed_at:issueAt};
    return {issue,order:{canonical_order_id:row.canonical_order_id,identity_status:row.identity_status,
      canonical_state:mapDropeaOrderState(rawOrder.status,rawOrder.sub_status).canonical_state,observed_at:orderAt},...conversation,
      verified_phone:verifiedAbsentOrderPhone({issue,providerOrder:rawOrder,observedAt:orderAt,privacyKey}),
      logistics_capability:absentSolutionCapability({issue,observedAt:issueAt})};
  }
  return {readFresh,async run(){
    if(!flags.AUSENTE_AUTOMATION_LIVE || !flags.AUSENTE_LOGISTICS_WRITES_ENABLED || !writer)return {status:'DISABLED',writes:0};
    const rows=await pool.query(`SELECT canonical_issue_id FROM read_models.operations_incident_records
      WHERE type='RECIPIENT_ABSENT' AND status='PENDING' AND is_active=true ORDER BY updated_at ASC LIMIT 20`);
    const counts={checked:0,writes:0,applied:0,blocked:0,uncertain:0};
    for(const row of rows.rows){
      let result;
      try {result=await executeRecipientAbsentResolution({issueId:row.canonical_issue_id,readFresh,
        readProviderIssue:async issue=>(await getClient(issue).request('getIssue',{id:Number(issue.dropea_issue_id)})).data,
        writer,ledger,flags,now});}
      catch {result={status:'HUMAN_REVIEW_REQUIRED',writes:0};}
      counts.checked++;counts.writes+=result.writes || 0;
      if(result.status==='APPLIED')counts.applied++;else if(result.status==='UNVERIFIED')counts.uncertain++;else counts.blocked++;
    }
    return counts;
  }};
}
