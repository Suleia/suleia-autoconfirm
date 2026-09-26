import {ABSENT_TEMPLATE_BUTTONS} from '../../../packages/platform-core/src/incident/absent-template.mjs';
import {absentCallbackContextMatches} from './absent-callback-contract.mjs';

// Store provider evidence separately from activation. Merely observing these
// rows does not install a contract or enable a Dropea write.
export function captureObservedAbsentCallbacks(messages,notice,now=new Date()){
  const samples=[],unknown=[];
  for(const m of messages){
    if(!absentCallbackContextMatches(m,notice,now))continue;
    const ids=[m.interactive?.button_reply?.id,m.payload?.button_reply?.id,m.button_payload,m.postback?.payload,m.payload?.payload]
      .filter(x=>typeof x==='string' && x.length);
    const id=[...new Set(ids)],text=m.interactive?.button_reply?.title || m.payload?.button_reply?.title || m.button_text || m.payload?.title;
    const button=ABSENT_TEMPLATE_BUTTONS.find(b=>b.text===text);
    const messageId=m.id || m.mid;
    if(!ids.length)continue;
    if(id.length!==1 || !/^f\d+n\d+$/.test(id[0]) || !button || !messageId){unknown.push({reason:'UNKNOWN_BOUND_V3_CALLBACK'});continue;}
    const eventAt=m.event_at || m.created_at || new Date(Number(m.ts)>1e12?Number(m.ts):Number(m.ts)*1000).toISOString();
    samples.push({status:'OBSERVED_REAL',real_button_id:id[0],real_payload:id[0],button_text:text,
      canonical_payload:button.payload,message_id:String(messageId),conversation_id:notice.conversation_id,
      template_id:'1552419',notification_message_id:notice.message_id,event_at:new Date(eventAt).toISOString()});
  }
  return {samples:[...new Map(samples.map(s=>[s.message_id,s])).values()].slice(-12),unknown};
}
