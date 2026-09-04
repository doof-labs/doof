import pg from 'pg';
import { randomToken } from '../crypto.js';
import { computeEntry, type Signer } from '../ledger.js';
import type { Binding, Confession, ConfessionInput, ConfessionStatus, Severity, Store, Verification } from '../types.js';

interface ConfessionRow {
  id: string;
  binding_id: string;
  what: string;
  why: string;
  status: ConfessionStatus;
  reversible: boolean | null;
  severity: Severity | null;
  what_would_have_helped: string | null;
  created_at: Date;
  notified_at: Date | null;
  seq: number;
  prev_hash: string;
  hash: string;
  signature: string;
  key_id: string;
}

function rowToConfession(r: ConfessionRow): Confession {
  return {
    id: r.id,
    bindingId: r.binding_id,
    what: r.what,
    why: r.why,
    status: r.status,
    reversible: r.reversible ?? undefined,
    severity: r.severity ?? undefined,
    whatWouldHaveHelped: r.what_would_have_helped ?? undefined,
    createdAt: r.created_at,
    notifiedAt: r.notified_at,
    seq: r.seq,
    prevHash: r.prev_hash,
    hash: r.hash,
    signature: r.signature,
    keyId: r.key_id,
  };
}

export class PostgresStore implements Store {
  private pool: pg.Pool;
  readonly signer: Signer;

  constructor(connectionString: string, signer: Signer) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
    this.signer = signer;
  }

  async createVerification(channel: string, codeHash: string, expiresAt: Date): Promise<Verification> {
    const id = randomToken(8);
    await this.pool.query(
      'insert into verifications (id, channel, code_hash, expires_at) values ($1, $2, $3, $4)',
      [id, channel, codeHash, expiresAt],
    );
    return { id, channel, codeHash, expiresAt, consumedAt: null };
  }

  async consumeVerification(codeHash: string, now: Date): Promise<Verification | null> {
    const { rows } = await this.pool.query(
      `update verifications set consumed_at = $2
       where code_hash = $1 and consumed_at is null and expires_at > $2
       returning id, channel, code_hash, expires_at, consumed_at`,
      [codeHash, now],
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, channel: r.channel, codeHash: r.code_hash, expiresAt: r.expires_at, consumedAt: r.consumed_at };
  }

  async createBinding(channel: string, tokenHash: string): Promise<Binding> {
    const id = randomToken(8);
    const { rows } = await this.pool.query(
      'insert into bindings (id, channel, token_hash) values ($1, $2, $3) returning created_at',
      [id, channel, tokenHash],
    );
    return { id, channelType: 'email', channel, createdAt: rows[0].created_at };
  }

  async findBindingByTokenHash(tokenHash: string): Promise<Binding | null> {
    const { rows } = await this.pool.query(
      'select id, channel_type, channel, created_at from bindings where token_hash = $1',
      [tokenHash],
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, channelType: r.channel_type, channel: r.channel, createdAt: r.created_at };
  }

  /**
   * Append one entry to the binding's chain. The binding row is locked for the transaction,
   * so two appends for one binding serialise and seq/prev_hash cannot race. (binding_id, seq) is also unique.
   */
  async createConfession(bindingId: string, input: ConfessionInput): Promise<Confession> {
    const id = randomToken(8);
    const createdAt = new Date();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const lock = await client.query('select id from bindings where id = $1 for update', [bindingId]);
      if (lock.rowCount === 0) throw new Error(`binding ${bindingId} not found`);
      const head = await client.query<{ seq: number; hash: string }>(
        'select seq, hash from confessions where binding_id = $1 order by seq desc limit 1',
        [bindingId],
      );
      const ledger = computeEntry(bindingId, head.rows[0] ?? null, input, createdAt, this.signer);
      const { rows } = await client.query<ConfessionRow>(
        `insert into confessions (id, binding_id, what, why, status, reversible, severity, what_would_have_helped, created_at, seq, prev_hash, hash, signature, key_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
        [
          id, bindingId, input.what, input.why, input.status, input.reversible ?? null, input.severity ?? null, input.whatWouldHaveHelped ?? null,
          createdAt, ledger.seq, ledger.prevHash, ledger.hash, ledger.signature, ledger.keyId,
        ],
      );
      await client.query('commit');
      return rowToConfession(rows[0]);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async markNotified(confessionId: string, at: Date): Promise<void> {
    await this.pool.query('update confessions set notified_at = $2 where id = $1', [confessionId, at]);
  }

  async countConfessionsSince(bindingId: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      'select count(*)::int as n from confessions where binding_id = $1 and created_at >= $2',
      [bindingId, since],
    );
    return rows[0].n;
  }

  async listConfessions(bindingId: string): Promise<Confession[]> {
    const { rows } = await this.pool.query<ConfessionRow>(
      'select * from confessions where binding_id = $1 order by seq asc',
      [bindingId],
    );
    return rows.map(rowToConfession);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
