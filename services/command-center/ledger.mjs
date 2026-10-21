import {createHash} from 'node:crypto';

// The same operational PostgreSQL and Ads capability role; no separate identity store.
export class CommandLedger {
  constructor(pool) { this.pool=pool; }
  async context(actor,now) {
    const r=await this.pool.query('SELECT body FROM economics.command_context WHERE actor=$1 AND expires_at>to_timestamp($2/1000.0)',[actor,now]);
    return r.rows[0]?.body||null;
  }
  async saveContext(actor,body,expiresAt) {
    await this.pool.query('INSERT INTO economics.command_context(actor,body,expires_at) VALUES($1,$2,to_timestamp($3/1000.0)) ON CONFLICT(actor) DO UPDATE SET body=EXCLUDED.body,expires_at=EXCLUDED.expires_at',[actor,body,expiresAt]);
  }
  async remember({actor,key,kind,evidence,at}) {
    const id=createHash('sha256').update(`${actor}:${key}:${kind}`).digest('hex');
    const body={kind,evidence,observedAt:new Date(at).toISOString(),externalWrites:0};
    await this.pool.query('INSERT INTO economics.command_decisions(id,actor,kind,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[id,actor,kind,body]);
    return id;
  }
  async history(actor) {
    return (await this.pool.query('SELECT id,kind,body,created_at FROM economics.command_decisions WHERE actor=$1 ORDER BY created_at DESC LIMIT 20',[actor])).rows;
  }
  async latest() {
    return (await this.pool.query("SELECT kind,body,created_at FROM economics.command_decisions WHERE kind='EXECUTIVE_BRIEF' ORDER BY created_at DESC LIMIT 1")).rows[0]||null;
  }
}
