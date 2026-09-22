import {verifiedAbsentOrderPhone} from '../../src/incident/absent-resolution.mjs';
import {absentSolutionCapability} from '../../../../services/integrations/dropea/absent-solution.mjs';
export const now='2026-09-22T12:00:00Z';
export function fixture(text='Mañana por la tarde'){
 const issue={canonical_issue_id:'issue-a',canonical_order_id:'order-a',dropea_issue_id:'123',dropea_order_id:'321',store_id:'store',market:'ES',carrier:'GLS',type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,created_at:'2026-09-22T09:00:00Z',observed_at:now,allowed_resolution_options:['PROVIDE_SOLUTION']};
 const event={canonical_issue_id:'issue-a',canonical_order_id:'order-a',direction:'INBOUND',relevance_status:'CURRENT_ORDER_EXACT_MATCH',chatby_conversation_id_hash:'conv',chatby_contact_id_hash:'contact',chatby_message_id:'message-1',created_at:'2026-09-22T11:00:00Z',raw_text:text,message_type:'TEXT'};
 return {issue,decision_currentness:'CURRENT',order:{canonical_order_id:'order-a',identity_status:'EXACT',canonical_state:'INCIDENCE',observed_at:now},
  events:[event],chatby:{verified:true,history_complete:true,notification_message_id:'notice',template_contact_verified:true,incident_notified_at:'2026-09-22T10:00:00Z',observed_at:now,chatby_conversation_id_hash:'conv',chatby_contact_id_hash:'contact'},
  verified_phone:verifiedAbsentOrderPhone({issue,providerOrder:{id:321,store_id:'store',customer_phone:'+34600000001'},observedAt:now,privacyKey:'synthetic-test-key-'.repeat(3)}),
  logistics_capability:absentSolutionCapability({issue,observedAt:now})};
}
