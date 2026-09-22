// Scope this handoff to AUSENTE. The shared incident owner must stay unchanged
// for rejection/discount and other existing incident lanes.
export function absentOwnedByNativeChatby(incident, env=process.env) {
  return incident?.incidentType==='absent' && env.AUSENTE_NOTIFICATION_OWNER==='chatby_native';
}
