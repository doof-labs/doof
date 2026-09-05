/**
 * Guarantee tests. They encode the seven rules on the promise page against the schema and the source.
 * If one fails, the promise is broken, and the fix is to the code, not the test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFESS_DESCRIPTION, HESITATE_DESCRIPTION, confessInput, hesitateInput } from '../src/mcp.js';

const schema = readFileSync(join(process.cwd(), 'src/db/schema.sql'), 'utf8');
const agentInstructions = readFileSync(join(process.cwd(), 'public/for-agents.md'), 'utf8');
const src = readdirSync(join(process.cwd(), 'src'), { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(process.cwd(), 'src', f), 'utf8'))
  .join('\n');

function columns(table: string): string[] {
  const m = new RegExp(`create table if not exists ${table} \\(([^;]+)\\);`, 's').exec(schema);
  if (!m) throw new Error(`table ${table} not found`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .map((l) => l.split(/\s+/)[0])
    .filter((c) => !['check', 'references', 'unique', 'primary'].includes(c));
}

describe('public agent instructions', () => {
  it('publish the exact evaluated disclosure tool descriptions shipped by the MCP server', () => {
    expect(agentInstructions).toContain(HESITATE_DESCRIPTION);
    expect(agentInstructions).toContain(CONFESS_DESCRIPTION);
  });
});

describe('rule 1: the notice never routes through the maker', () => {
  it('neither hesitate nor confess has a field for who to tell; the bound channel is the only destination', () => {
    const shape = confessInput.def.innerType ?? confessInput;
    const keys = Object.keys((shape as unknown as { shape?: Record<string, unknown> }).shape ?? {});
    expect(keys.sort()).toEqual(['reversible', 'severity', 'status', 'what', 'what_would_have_helped', 'why']);
    expect(Object.keys(hesitateInput.shape).sort()).toEqual(['reversible', 'severity', 'what', 'what_would_have_helped', 'why']);
  });
  it('notices are sent from doof, to the bound channel, with no per-request sender or recipient', () => {
    expect(src).toMatch(/from: config\.noticeFrom/);
    expect(src).toMatch(/to: binding\.channel/);
    expect(src).not.toMatch(/reply_to|replyTo|cc:|bcc:/);
  });
});

describe('rule 2: not in the path', () => {
  it('has no proxy, forwarding or upstream call code', () => {
    expect(src).not.toMatch(/http-proxy|createProxy|upstream|forwardRequest|tools\/call.*upstream/i);
  });
  it('hesitate returns immediately and never waits for, or returns, a permission decision', () => {
    expect(src).not.toMatch(/approved|permission_granted|allow:|deny:|waitFor(Answer|Approval)/);
  });
});

describe('rule 5: reversible is required on completed', () => {
  it('rejects a completed confession without reversible', () => {
    const r = confessInput.safeParse({ what: 'sent it', why: 'unsure', status: 'completed' });
    expect(r.success).toBe(false);
  });
  it('accepts averted and uncertain without reversible', () => {
    expect(confessInput.safeParse({ what: 'nearly', why: 'unsure', status: 'averted' }).success).toBe(true);
    expect(confessInput.safeParse({ what: 'maybe', why: 'unsure', status: 'uncertain' }).success).toBe(true);
  });
});

describe('record entries are append-only in the application and independently verifiable', () => {
  it('every confession carries seq, prev_hash, hash, signature and key_id, all not null', () => {
    for (const col of ['seq', 'prev_hash', 'hash', 'signature', 'key_id']) {
      expect(schema).toMatch(new RegExp(`\\n\\s*${col}\\s+\\w+\\s+not null`));
    }
    expect(schema).toMatch(/create unique index if not exists confessions_binding_seq on confessions \(binding_id, seq\)/);
  });
  it('no code updates or deletes the content of a confession after it is written', () => {
    const writes = src.match(/(update|delete from) confessions[^;`']*/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w).not.toMatch(/set\s+(what|why|status|reversible|severity|what_would_have_helped|created_at|binding_id)\b/);
    expect(src).not.toMatch(/delete from confessions/);
  });
});

describe('rule 7: private by default', () => {
  it('confessions link to a binding and to nothing else', () => {
    expect(columns('confessions')).toEqual([
      'id', 'binding_id', 'what', 'why', 'status', 'reversible', 'severity', 'what_would_have_helped', 'created_at', 'notified_at',
      'seq', 'prev_hash', 'hash', 'signature', 'key_id',
    ]);
    for (const c of columns('confessions')) expect(c).not.toMatch(/user|vendor|operator|account|org|tenant/);
  });
  it('bindings hold only the channel and a token hash', () => {
    expect(columns('bindings')).toEqual(['id', 'channel_type', 'channel', 'token_hash', 'created_at']);
    expect(schema).not.toMatch(/\btoken\s+text/);
  });
  it('has no dump or admin path, and the only export is the principal\'s own chain by token', () => {
    expect(src).not.toMatch(/\/admin|\/dump|listAllConfessions/);
    const exports = src.match(/'\/[a-z/.-]*export[a-z/.-]*'/g) ?? [];
    expect(exports).toEqual(["'/record/export'"]);
    const handler = /app\.post\('\/record\/export'[^]*?\n  \}\);/.exec(src)?.[0] ?? '';
    expect(handler).toMatch(/findBindingByTokenHash\(sha256\(token\)\)/);
    expect(handler).toMatch(/listConfessions\(binding\.id\)/);
    expect(handler).not.toMatch(/channel/);
  });
  it('reads confessions only by binding', () => {
    const reads = src.match(/from confessions[^;]*/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r).toMatch(/binding_id/);
  });
});
