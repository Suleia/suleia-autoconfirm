import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.OPERATIONS_DATABASE_URL,max:1,statement_timeout:5000});
try{const state=(await pool.query("SELECT body FROM analytics.runtime_state WHERE state_key='materializer'")).rows[0]?.body;
 if(!state||state.last_error||Date.now()-Date.parse(state.last_success)>900000)process.exitCode=1;
}catch{process.exitCode=1;}finally{await pool.end();}
