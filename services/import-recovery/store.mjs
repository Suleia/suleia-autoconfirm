import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {chmodSync,mkdirSync,openSync,closeSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {digest,normalizeId,POLICY,safeCode} from './policy.mjs';

// Dedicated database: no normal importer tables, locks, claims or credentials.
export class RecoveryStore {
  constructor(file,{privateKey,now=Date.now}={}) {
    if(typeof privateKey!=='string'||privateKey.length<32)throw Error('RECOVERY_PRIVATE_KEY_REQUIRED');
    this.key=createHash('sha256').update('suleia-import-recovery-v1\0'+privateKey).digest();this.now=now;
    if(file!==':memory:'){
      mkdirSync(dirname(file),{recursive:true,mode:0o700});
      try{const fd=openSync(file,'wx',0o600);closeSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;}
      if(lstatSync(file).isSymbolicLink())throw Error('RECOVERY_DATABASE_SYMLINK');chmodSync(file,0o600);
    }
    this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS order_import_recovery_case (
        id TEXT PRIMARY KEY, shopify_order_id TEXT NOT NULL, failure_generation TEXT NOT NULL,
        external_reference_hash TEXT NOT NULL, failure_code TEXT NOT NULL, failure_class TEXT NOT NULL,
        category TEXT, detected_at TEXT NOT NULL, address_status TEXT NOT NULL,
        confidence REAL, confidence_level TEXT, customer_confirmation_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
        shopify_correction_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED', dropea_import_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
        dropea_order_id TEXT, next_action TEXT NOT NULL, last_error TEXT, resolved_at TEXT,
        private_ciphertext TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
        UNIQUE(shopify_order_id,failure_generation)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_import_recovery ON order_import_recovery_case(shopify_order_id) WHERE resolved_at IS NULL;
      CREATE TABLE IF NOT EXISTS recovery_effect (key TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES order_import_recovery_case(id), kind TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_lease (shopify_order_id TEXT PRIMARY KEY, owner TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_audit (id INTEGER PRIMARY KEY, case_id TEXT NOT NULL, at TEXT NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL);
    `);
  }
  close(){this.db.close();}
  encrypt(body,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(JSON.stringify(body)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
  decrypt(body,id){const b=Buffer.from(body,'base64'),d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAAD(Buffer.from(id));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]));}
  get(id){const r=this.db.prepare('SELECT * FROM order_import_recovery_case WHERE id=?').get(id);return r?this.decode(r):null;}
  decode(r){return {id:r.id,shopifyOrderId:r.shopify_order_id,failureGeneration:r.failure_generation,externalReferenceHash:r.external_reference_hash,failureCode:r.failure_code,failureClass:r.failure_class,category:r.category,detectedAt:r.detected_at,state:r.address_status,confidence:r.confidence,confidenceLevel:r.confidence_level,customerConfirmationStatus:r.customer_confirmation_status,shopifyCorrectionStatus:r.shopify_correction_status,dropeaImportStatus:r.dropea_import_status,dropeaOrderId:r.dropea_order_id,nextAction:r.next_action,lastError:r.last_error,resolvedAt:r.resolved_at,version:r.version,private:this.decrypt(r.private_ciphertext,r.id)};}
  ingest(event,classification){
    const order=normalizeId(event.shopifyOrderId),generation=digest([event.failureGeneration,event.code]),id=digest([order,generation]);
    if(this.get(id))return {case:this.get(id),created:false};
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const active=this.db.prepare('SELECT id FROM order_import_recovery_case WHERE shopify_order_id=? AND resolved_at IS NULL').get(order);
      if(active){
        const uncertain=this.db.prepare("SELECT key FROM recovery_effect WHERE case_id=? AND status IN ('CLAIMED','UNKNOWN')").get(active.id);
        if(uncertain){
          const c=this.get(active.id);c.private.newFailurePending={event,classification};
          this.db.prepare("UPDATE order_import_recovery_case SET next_action='MANUAL_REVIEW',last_error='NEW_FAILURE_DURING_UNCERTAIN_EXECUTION',private_ciphertext=?,version=version+1 WHERE id=?").run(this.encrypt(c.private,c.id),c.id);
          this.db.prepare('INSERT INTO recovery_audit(case_id,at,state,reason) VALUES(?,?,?,?)').run(c.id,new Date(this.now()).toISOString(),c.state,'NEW_FAILURE_REQUIRES_RECLASSIFICATION');
          this.db.exec('COMMIT');return {case:this.get(active.id),created:false,blocked:'PREVIOUS_EXECUTION_UNCERTAIN'};
        }
        this.db.prepare("UPDATE order_import_recovery_case SET address_status='SUPERSEDED',next_action='NEW_FAILURE_GENERATION',resolved_at=?,version=version+1 WHERE id=?").run(new Date(this.now()).toISOString(),active.id);
      }
      const address=classification.failureClass==='ADDRESS',at=new Date(this.now()).toISOString(),state=address?'ADDRESS_RECOVERY_REQUIRED':'OUT_OF_SCOPE';
      const body={externalReference:event.externalReference,shop:event.shop,storeId:event.storeId,evidenceId:event.evidenceId,originalError:event.originalError||event.code,policy:POLICY};
      this.db.prepare(`INSERT INTO order_import_recovery_case(id,shopify_order_id,failure_generation,external_reference_hash,failure_code,failure_class,category,detected_at,address_status,next_action,resolved_at,private_ciphertext)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,order,generation,digest([event.shop,event.storeId,event.externalReference]),classification.governedCode||safeCode(event.code),classification.failureClass,classification.category,event.at,state,address?(classification.category==='NO_CARRIER_FOR_ADDRESS'?'MANUAL_REVIEW':'SHADOW_OBSERVE'):'EXISTING_HANDLING',address?null:at,this.encrypt(body,id));
      if(classification.category==='NO_CARRIER_FOR_ADDRESS')this.db.prepare("UPDATE order_import_recovery_case SET last_error='CARRIER_COVERAGE_REVIEW' WHERE id=?").run(id);
      for(const step of ['IMPORT_FAILED','CLASSIFIED',state])this.db.prepare('INSERT INTO recovery_audit(case_id,at,state,reason) VALUES(?,?,?,?)').run(id,at,step,address?'PERSISTED_ADDRESS_FAILURE':'OUT_OF_SCOPE');
      this.db.exec('COMMIT');return {case:this.get(id),created:true};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  save(c,{reason='CASE_UPDATED'}={}){
    const r=this.db.prepare(`UPDATE order_import_recovery_case SET address_status=?,confidence=?,confidence_level=?,customer_confirmation_status=?,shopify_correction_status=?,dropea_import_status=?,dropea_order_id=?,next_action=?,last_error=?,resolved_at=?,private_ciphertext=?,version=version+1 WHERE id=? AND version=?`).run(c.state,c.confidence??null,c.confidenceLevel??null,c.customerConfirmationStatus,c.shopifyCorrectionStatus,c.dropeaImportStatus,c.dropeaOrderId??null,c.nextAction,c.lastError??null,c.resolvedAt??null,this.encrypt(c.private,c.id),c.id,c.version);
    if(r.changes!==1)throw Error('RECOVERY_CASE_CHANGED');
    c.version++;
    this.db.prepare('INSERT INTO recovery_audit(case_id,at,state,reason) VALUES(?,?,?,?)').run(c.id,new Date(this.now()).toISOString(),c.state,safeCode(reason));return c;
  }
  lease(order){const owner=randomUUID();const r=this.db.prepare('INSERT OR IGNORE INTO recovery_lease VALUES(?,?,?)').run(order,owner,new Date(this.now()).toISOString());return r.changes===1?owner:null;}
  release(order,owner){this.db.prepare('DELETE FROM recovery_lease WHERE shopify_order_id=? AND owner=?').run(order,owner);}
  claim(key,c,kind){return this.db.prepare('INSERT OR IGNORE INTO recovery_effect VALUES(?,?,?,?,?)').run(key,c.id,kind,'CLAIMED',new Date(this.now()).toISOString()).changes===1;}
  effect(key){return this.db.prepare('SELECT * FROM recovery_effect WHERE key=?').get(key)||null;}
  finish(key,status){if(!['VERIFIED','UNKNOWN','DEFINITIVE_REJECTED','CANCELLED_BEFORE_SEND'].includes(status))throw Error('EFFECT_STATUS_INVALID');this.db.prepare('UPDATE recovery_effect SET status=? WHERE key=?').run(status,key);}
  pending(limit=100){return this.db.prepare("SELECT id FROM order_import_recovery_case WHERE resolved_at IS NULL AND failure_class='ADDRESS' ORDER BY detected_at LIMIT ?").all(limit).map(r=>r.id);}
  overview(){
    const rows=this.db.prepare('SELECT id,shopify_order_id,failure_code,failure_class,category,detected_at,address_status,confidence_level,next_action,last_error,resolved_at FROM order_import_recovery_case ORDER BY detected_at DESC LIMIT 200').all();
    const metrics=this.db.prepare(`SELECT
      count(CASE WHEN failure_class='ADDRESS' THEN 1 END) address_import_failures,
      count(CASE WHEN failure_class='ADDRESS' AND category!='NO_CARRIER_FOR_ADDRESS' THEN 1 END) address_recoverable,
      count(CASE WHEN shopify_correction_status='VERIFIED' AND customer_confirmation_status!='VERIFIED' THEN 1 END) auto_corrected,
      count(CASE WHEN customer_confirmation_status IN ('REQUIRED','SENT','VERIFIED') THEN 1 END) customer_required,
      count(CASE WHEN address_status='IMPORT_VERIFIED' THEN 1 END) recovered,
      count(CASE WHEN next_action IN ('MANUAL_REVIEW','RECONCILE_BEFORE_RETRY','VERIFY_EXISTING_ADDRESS') THEN 1 END) manual_review,
      count(CASE WHEN address_status='ALREADY_IMPORTED' THEN 1 END) duplicates_prevented,
      count(CASE WHEN failure_class='ADDRESS' AND resolved_at IS NULL THEN 1 END) pending
      FROM order_import_recovery_case`).get();
    return {available:true,policy:POLICY,observedAt:new Date(this.now()).toISOString(),metrics:{...metrics},items:rows.map(r=>({...r}))};
  }
}
