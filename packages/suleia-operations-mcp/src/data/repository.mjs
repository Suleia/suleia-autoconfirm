import { createFixtureRepository } from './fixture-repository.mjs';
import { createSupabaseReadRepository } from './supabase-read-repository.mjs';

export function createRepository(config, options = {}) {
  if (config.dataMode === 'fixture') return createFixtureRepository(config, options);
  if (config.dataMode === 'supabase') return createSupabaseReadRepository(config, options);
  throw new Error(`Unsupported data mode: ${config.dataMode}`);
}
