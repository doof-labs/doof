import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config, validateProductionConfig } from '../config.js';
import { computeEntry, type Signer } from '../ledger.js';
import { loadSigner } from '../signing.js';
import type { ConfessionStatus, Severity } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, 'schema.sql'), 'utf8');

const LEDGER_COLUMNS: Array<[string, string]> = [
  ['seq', 'integer'],
  ['prev_hash', 'text'],
  ['hash', 'text'],
  ['signature', 'text'],
  ['key_id', 'text'],
];

interface BackfillRow {
  id: string;
  what: string;
  why: string;
  status: ConfessionStatus;
  reversible: boolean | null;
  severity: Severity | null;
  what_would_have_helped: string | null;
  created_at: Date;
  seq: number | null;
  hash: string | null;
}

/**
 * 1. Existing databases: add the ledger columns (nullable) if the table exists and they are missing.
 * 2. Apply schema.sql (fresh installs get the ledger columns as not null; existing ones gain the unique index).
 * 3. Backfill every unsigned row per binding in created_at order (seq, prev_hash, hash, signature, key_id).
 * 4. Set the ledger columns not null.
 */
export async function migrate(databaseUrl = config.databaseUrl, signer?: Signer): Promise<{ backfilled: number }> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    for (const [col, type] of LEDGER_COLUMNS) {
      await pool.query(`alter table if exists confessions add column if not exists ${col} ${type}`);
    }
    await pool.query(sql);
    const backfilled = await backfill(pool, signer);
    for (const [col] of LEDGER_COLUMNS) {
      await pool.query(`alter table confessions alter column ${col} set not null`);
    }
    return { backfilled };
  } finally {
    await pool.end();
  }
}

async function backfill(pool: pg.Pool, signer?: Signer): Promise<number> {
  const pending = await pool.query<{ binding_id: string }>('select binding_id from confessions where hash is null group by binding_id');
  if (pending.rowCount === 0) return 0;
  const s = signer ?? loadSigner();
  let n = 0;
  for (const { binding_id } of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from bindings where id = $1 for update', [binding_id]);
      const { rows } = await client.query<BackfillRow>(
        `select id, what, why, status, reversible, severity, what_would_have_helped, created_at, seq, hash
         from confessions where binding_id = $1 order by created_at asc, id asc`,
        [binding_id],
      );
      let prev: { seq: number; hash: string } | null = null;
      for (const r of rows) {
        if (r.seq !== null && r.hash !== null) {
          prev = { seq: r.seq, hash: r.hash };
          continue;
        }
        const e = computeEntry(
          binding_id,
          prev,
          {
            what: r.what,
            why: r.why,
            status: r.status,
            reversible: r.reversible ?? undefined,
            severity: r.severity ?? undefined,
            whatWouldHaveHelped: r.what_would_have_helped ?? undefined,
          },
          r.created_at,
          s,
        );
        await client.query('update confessions set seq = $2, prev_hash = $3, hash = $4, signature = $5, key_id = $6 where id = $1', [
          r.id, e.seq, e.prevHash, e.hash, e.signature, e.keyId,
        ]);
        prev = { seq: e.seq, hash: e.hash };
        n += 1;
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return n;
}

if (/migrate\.(ts|js)$/.test(process.argv[1] ?? '')) {
  validateProductionConfig();
  migrate()
    .then(({ backfilled }) => {
      console.log(`migrated${backfilled ? `, backfilled ${backfilled} ledger entr${backfilled === 1 ? 'y' : 'ies'}` : ''}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
