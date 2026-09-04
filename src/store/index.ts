import { config } from '../config.js';
import type { Signer } from '../ledger.js';
import type { Store } from '../types.js';
import { MemoryStore } from './memory.js';
import { PostgresStore } from './postgres.js';

export function createStore(signer: Signer): Store {
  if (config.store === 'memory') return new MemoryStore(signer);
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required when STORE=postgres');
  return new PostgresStore(config.databaseUrl, signer);
}
