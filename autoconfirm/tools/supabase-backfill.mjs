import { backfillSupabaseFromLocal, testSupabaseConnection } from '../src/db/supabase-store.mjs';

const status = await testSupabaseConnection();
console.log(JSON.stringify({ step: 'supabase_status', ...status }, null, 2));

if (!status.ok) {
  process.exitCode = 1;
} else {
  const result = await backfillSupabaseFromLocal();
  console.log(JSON.stringify({ step: 'supabase_backfill', ...result }, null, 2));
}
