import {materializeAddress,ADDRESS_POLICY_HASH} from '../packages/platform-core/src/incident/address-canonical.mjs';

export async function projectAddressCanonical(pool,canonicalIssueId,{now=new Date()}={}) {
 const db=await pool.connect();
 try {
  await db.query('BEGIN');
  const {rows}=await db.query(`SELECT i.*,a.observation FROM read_models.operations_incident_records i
   LEFT JOIN operations.address_owner_observations a USING(canonical_issue_id)
   WHERE i.canonical_issue_id=$1 AND i.type='ADDRESS_INCORRECT' FOR UPDATE OF i`,[canonicalIssueId]);
  const issue=rows[0];
  if(!issue){await db.query('COMMIT');return {matched:false};}
  const p=await db.query(`SELECT p.id AS policy_id,v.checksum AS policy_snapshot_hash FROM configuration.policies p
   JOIN configuration.policy_versions v USING(policy_name) JOIN configuration.policy_assignments a ON a.policy_id=p.id AND a.version_id=v.id
   WHERE p.policy_name='ADDRESS_INCORRECT_POLICY_V1' AND v.version='ADDRESS_INCORRECT_POLICY_V1'
   AND a.workflow='ADDRESS_INCORRECT' AND a.status='SHADOW' AND v.status='SHADOW' AND v.checksum=$1`,[ADDRESS_POLICY_HASH]);
  const previous=await db.query(`SELECT snapshot FROM operations.address_decision_snapshots WHERE canonical_issue_id=$1 ORDER BY decided_at DESC LIMIT 1`,[canonicalIssueId]);
  const history=await db.query(`SELECT blocking_reasons FROM operations.incident_simulation_decisions WHERE canonical_issue_id=$1 ORDER BY created_at DESC LIMIT 1`,[canonicalIssueId]);
  const s=materializeAddress({issue:{...issue,blocking_reasons:[...(issue.blocking_reasons||[]),...(history.rows[0]?.blocking_reasons||[])]},observation:issue.observation||{},policy:p.rows[0],previous:previous.rows[0]?.snapshot,now});
  if(!s.policy_id)throw Error('ADDRESS_POLICY_REGISTRY_UNVERIFIED');
  await db.query(`INSERT INTO operations.address_decision_snapshots
   (decision_id,canonical_issue_id,canonical_order_id,issue_version,policy_id,policy_version,policy_snapshot_hash,input_snapshot_hash,snapshot)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(decision_id) DO NOTHING`,
   [s.decision_id,canonicalIssueId,issue.canonical_order_id,issue.updated_at,s.policy_id,s.policy_version,s.policy_snapshot_hash,s.input_snapshot_hash,JSON.stringify(s)]);
  // Preserve invalid legacy windows as audited history, never delete them.
  await db.query(`INSERT INTO operations.address_timer_reconciliation(timer_id,canonical_issue_id,reason,original_status,effective_timer_id)
   SELECT timer_id,canonical_issue_id,'INVALID_ANCHOR',status,$2 FROM operations.incident_timers
   WHERE canonical_issue_id=$1 AND timer_type='CUSTOMER_INITIAL_RESPONSE_48H' AND policy_version<>'ADDRESS_INCORRECT_RESPONSE_V1'
   ON CONFLICT(timer_id) DO UPDATE SET effective_timer_id=coalesce(EXCLUDED.effective_timer_id,operations.address_timer_reconciliation.effective_timer_id)`,[canonicalIssueId,s.timer?.timer_id||null]);
  await db.query(`UPDATE operations.incident_timers SET status='SUPERSEDED',superseded_by=$2,updated_at=now()
   WHERE canonical_issue_id=$1 AND timer_type='CUSTOMER_INITIAL_RESPONSE_48H' AND policy_version<>'ADDRESS_INCORRECT_RESPONSE_V1'
   AND (status<>'SUPERSEDED' OR superseded_by IS DISTINCT FROM $2)`,[canonicalIssueId,s.timer?.timer_id||null]);
  if(s.timer){const t=s.timer;
   await db.query(`INSERT INTO operations.incident_timers(timer_id,canonical_order_id,canonical_issue_id,issue_version,source_event_id,timer_type,started_at,due_at,status,policy_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(timer_id) DO UPDATE SET
    status=CASE WHEN operations.incident_timers.status='SUPERSEDED' THEN 'SUPERSEDED' ELSE EXCLUDED.status END,
    updated_at=now()`,[t.timer_id,issue.canonical_order_id,canonicalIssueId,issue.updated_at,t.notification_message_id,t.timer_type,t.started_at,t.due_at,t.status,t.policy_version]);
  }
  if(s.finding)await db.query(`INSERT INTO operations.address_provider_findings(canonical_issue_id,finding)
    VALUES($1,$2::jsonb) ON CONFLICT(canonical_issue_id) DO UPDATE SET finding=EXCLUDED.finding,updated_at=now()`,[canonicalIssueId,JSON.stringify(s.finding)]);
  await db.query(`UPDATE read_models.operations_incident_records SET policy_id=$2,decision_id=$3,
    customer_response_status=$4,customer_intent=$5,blocking_reasons=$6,due_at=$7,qa_result=$8
    WHERE canonical_issue_id=$1`,[canonicalIssueId,s.policy_id,s.decision_id,
    s.current?(issue.observation?.initial_milestones?'RESPONDED':'NO_RESPONSE'):'UNKNOWN',issue.observation?.intent||'UNKNOWN',
    s.blocking_reasons,s.timer?.due_at||null,s.action==='HUMAN_REVIEW'?'BLOCKED':'REVIEW']);
  await db.query('COMMIT');return {matched:true,decision:s,external_writes:0};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
