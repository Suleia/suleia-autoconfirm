// Read-only offline corpus preparation. Run in the existing private reader
// environment; never writes source tables or sends provider requests.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decryptOperationsPrivateJson} from '../packages/suleia-operations-mcp/src/operations/private-display.mjs';
import {encryptPrivateJson} from '../packages/platform-core/src/operational-truth/dropea-canonical.mjs';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function sanitizeBenchmarkText(text){
  return String(text||'').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[PRIVATE]')
    .replace(/\bES\d{6,}\b|\b\d{5,}\b|(?:\+34[ -]?)?(?:[67]\d[ -]?){4,}\d?\b/g,'[PRIVATE]')
    .replace(/\b(?:me llamo|mi nombre es)\s+[^,.!?\n]+/gi,'[PERSON]')
    .replace(/\b(?:calle|avenida|avda\.?|carrer|paseo)\s+[^.!?\n]+/gi,'[ADDRESS]')
    .slice(0,1500);
}
export async function prepareBenchmark({pool,key,limit=400}){
  const source=await pool.query({text:`WITH selected AS (
    SELECT DISTINCT ON (l.canonical_order_id) l.canonical_order_id,l.canonical_issue_id,
      l.chatby_conversation_id_hash,l.evidence_hash,l.observed_at,i.normalized_type,
      i.order_status,i.status AS issue_status,i.is_active,i.resolution_status,
      i.allowed_resolution_options,i.created_at AS issue_at,o.created_at_utc AS order_at
    FROM operations.chatby_conversation_links l
    JOIN read_models.operations_incident_evidence_context i USING(canonical_order_id,canonical_issue_id)
    JOIN read_models.operations_order_context o USING(canonical_order_id)
    WHERE l.conversation_status='FOUND' AND l.evidence_hash IS NOT NULL
      AND EXISTS(SELECT 1 FROM operations.chatby_private_message_display m
        WHERE m.canonical_order_id=l.canonical_order_id AND m.canonical_issue_id=l.canonical_issue_id AND m.direction='INBOUND')
    ORDER BY l.canonical_order_id,l.observed_at DESC LIMIT $1)
    SELECT s.*, (SELECT json_agg(json_build_object('id',m.chatby_message_id_hash,
      'direction',m.direction,'type',m.message_type,'text',m.message_text_ciphertext,
      'at',m.occurred_at,'template',m.context_template_slug,'relation',m.relation_to_issue) ORDER BY m.occurred_at,m.chatby_message_id_hash)
      FROM operations.chatby_private_message_display m WHERE m.canonical_order_id=s.canonical_order_id AND m.canonical_issue_id=s.canonical_issue_id) AS messages
    FROM selected s`,values:[Math.min(500,Math.max(300,limit))],query_timeout:20000});
  const cases=source.rows.map((r,index)=>({
    case_id:sha([r.canonical_order_id,r.canonical_issue_id]),source:'REAL_SANITIZED_PRIVATE_SNAPSHOT',
    provenance:{binding_evidence_hash:r.evidence_hash,source_conversation_hash:r.chatby_conversation_id_hash,snapshot_at:r.observed_at},
    order_state:{orderId:String(900000+index),status:r.order_status,createdAt:r.order_at},
    incident_state:{incidenceId:String(800000+index),incidentType:({RECIPIENT_ABSENT:'absent',REFUSED_BY_RECIPIENT:'rejected_goods',ADDRESS_INCORRECT:'address'})[r.normalized_type]||r.normalized_type,incidenceDate:r.issue_at,status:r.issue_status,is_active:r.is_active,resolution_status:r.resolution_status,allowed_resolution_options:r.allowed_resolution_options},
    conversation:r.messages.map((m,i)=>({id:String(i),direction:m.direction,type:m.type,at:m.at,template:m.template,
      text:sanitizeBenchmarkText(decryptOperationsPrivateJson(m.text,key)?.text),source_event_hash:m.id,relation:m.relation})),
    expected_current_facts:null,expected_superseded_facts:null,expected_missing_information:null,
    expected_owner:null,expected_operational_action:null,expected_reply_action:null,expected_human_review:null,
    annotation_status:'UNREVIEWED',split:'UNASSIGNED'
  }));
  return {schema_version:'SULEIA_CONVERSATION_BENCHMARK_V1',created_at:new Date().toISOString(),source_writes:0,provider_calls:0,cases};
}
if(process.argv[1]?.endsWith('export-conversation-benchmark.mjs')){
  const output=process.argv[2];if(!output?.startsWith('/tmp/')&&!output?.startsWith('/state/'))throw Error('PRIVATE_DESTINATION_REQUIRED');
  const {ShadowRepository}=await import('../packages/suleia-operations-mcp/src/shadow/repository.mjs');
  const repo=new ShadowRepository(process.env.SHADOW_DATABASE_URL);repo.pool.options.connectionTimeoutMillis=5000;
  try{
    const corpus=await prepareBenchmark({pool:repo.pool,key:process.env.MIGRATION_HASH_KEY});
    await writeFile(output,encryptPrivateJson(corpus,process.env.MIGRATION_HASH_KEY),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({cases:corpus.cases.length,reviewed:0,encrypted:true,source_writes:0,provider_calls:0,corpus_hash:sha(corpus),release_ready:false}));
  }finally{await repo.close();}
}
