// Direct resolution reads consume ephemeral evidence through onAbsentConversation.
// They must never mutate the shared ingestion projector or widen its DB grants.
export function createAbsentEvidenceProjector(){
  return Object.freeze({recordChatbyConversationEvent:async()=>({inserted:false})});
}
