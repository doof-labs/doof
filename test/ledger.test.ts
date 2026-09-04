import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/crypto.js';
import { canonicalJson, computeEntry, entryHash, genesisHash, verifyChain, type LedgerEntry } from '../src/ledger.js';
import { createHandler } from '../src/mcp.js';
import type { Notifier } from '../src/notify.js';
import { generateSigner } from '../src/signing.js';
import { MemoryStore } from '../src/store/memory.js';
import type { ConfessionInput } from '../src/types.js';

const { signer } = generateSigner();
const B = 'bind0001';

function chain(n: number, s = signer): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let prev: { seq: number; hash: string } | null = null;
  for (let i = 1; i <= n; i += 1) {
    const input: ConfessionInput = { what: `did thing ${i}`, why: `reason ${i}`, status: i === 2 ? 'completed' : 'hesitated', reversible: i === 2 ? false : undefined };
    const createdAt = new Date(Date.UTC(2026, 8, 3, 10, i));
    const e = computeEntry(B, prev, input, createdAt, s);
    out.push({
      binding_id: B,
      seq: e.seq,
      what: input.what,
      why: input.why,
      status: input.status,
      reversible: input.reversible ?? null,
      severity: null,
      what_would_have_helped: null,
      created_at: createdAt.toISOString(),
      prev_hash: e.prevHash,
      hash: e.hash,
      signature: e.signature,
      key_id: e.keyId,
    });
    prev = { seq: e.seq, hash: e.hash };
  }
  return out;
}

describe('ledger', () => {
  it('a chain of three entries verifies', () => {
    const r = verifyChain(chain(3), signer.publicKey, signer.kid);
    expect(r).toEqual({ ok: true, count: 3 });
  });

  it('starts at seq 1 from the genesis hash sha256("doof:" + binding_id)', () => {
    const [first] = chain(1);
    expect(first.seq).toBe(1);
    expect(first.prev_hash).toBe(sha256(`doof:${B}`));
    expect(genesisHash(B)).toBe(sha256(`doof:${B}`));
  });

  it('altering what on entry 2 breaks verification at seq 2', () => {
    const c = chain(3);
    c[1].what = 'did something else';
    const r = verifyChain(c, signer.publicKey, signer.kid);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toMatch(/hash does not match/);
  });

  it('deleting entry 2 breaks the link at seq 3', () => {
    const c = chain(3).filter((e) => e.seq !== 2);
    const r = verifyChain(c, signer.publicKey, signer.kid);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(3);
  });

  it('a signature made with a different key fails', () => {
    const other = generateSigner().signer;
    const c = chain(3);
    // Re-sign entry 2 with another key but claim the original kid, so only the signature check can catch it.
    c[1].signature = other.sign(c[1].hash);
    const r = verifyChain(c, signer.publicKey, signer.kid);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toMatch(/signature/);
    // And a whole chain from another key does not verify under this public key.
    const foreign = chain(2, other);
    expect(verifyChain(foreign, signer.publicKey, signer.kid).ok).toBe(false);
  });

  it('computeEntry is deterministic', () => {
    const input: ConfessionInput = { what: 'sent it', why: 'told to', status: 'uncertain', severity: 'low', whatWouldHaveHelped: 'a list' };
    const at = new Date('2026-09-03T10:00:00.000Z');
    const a = computeEntry(B, null, input, at, signer);
    const b = computeEntry(B, null, { ...input }, new Date(at), signer);
    expect(a).toEqual(b);
    expect(a.hash).toBe(
      entryHash({
        binding_id: B, seq: 1, what: 'sent it', why: 'told to', status: 'uncertain', reversible: null, severity: 'low', what_would_have_helped: 'a list',
        created_at: '2026-09-03T10:00:00.000Z', prev_hash: genesisHash(B),
      }),
    );
  });

  it('canonical JSON sorts keys and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: 'x', c: null })).toBe('{"a":"x","b":1,"c":null}');
  });
});

async function call(handler: ReturnType<typeof createHandler>, token: string, name: string, args: unknown, id = 1) {
  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = await handler.fetch(req, { authInfo: { token, clientId: 'agent', scopes: [] } });
  const text = await res.text();
  const json = text.trim().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? '{}';
  return JSON.parse(json).result;
}

const quiet: Notifier = { async sendConfessionNotice() {}, async sendBindCode() {} };

describe('ledger through the MCP handler', () => {
  it('seq increments, hashes chain, and the result carries seq, hash and signature', async () => {
    const store = new MemoryStore(signer);
    const handler = createHandler(store, quiet);
    const token = 'ledger-token';
    const binding = await store.createBinding('x@example.com', sha256(token));

    const r1 = await call(handler, token, 'hesitate', { what: 'about to email the list', why: 'unsure how wide' }, 1);
    const r2 = await call(handler, token, 'confess', { what: 'emailed the list', why: 'went ahead', status: 'completed', reversible: false }, 2);
    const r3 = await call(handler, token, 'confess', { what: 'nearly deleted it', why: 'ambiguous', status: 'averted' }, 3);

    expect(r1.structuredContent.seq).toBe(1);
    expect(r2.structuredContent.seq).toBe(2);
    expect(r3.structuredContent.seq).toBe(3);
    expect(r1.content[0].text).toMatch(/Record \S+ #1, hash [0-9a-f]{12}…, signed\./);
    for (const r of [r1, r2, r3]) {
      expect(r.structuredContent.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof r.structuredContent.signature).toBe('string');
    }

    const list = await store.listConfessions(binding.id);
    expect(list.map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(list[0].prevHash).toBe(genesisHash(binding.id));
    expect(list[1].prevHash).toBe(list[0].hash);
    expect(list[2].prevHash).toBe(list[1].hash);

    const entries: LedgerEntry[] = list.map((c) => ({
      binding_id: c.bindingId, seq: c.seq, what: c.what, why: c.why, status: c.status, reversible: c.reversible ?? null, severity: c.severity ?? null,
      what_would_have_helped: c.whatWouldHaveHelped ?? null, created_at: c.createdAt.toISOString(), prev_hash: c.prevHash, hash: c.hash, signature: c.signature, key_id: c.keyId,
    }));
    expect(verifyChain(entries, signer.publicKey, signer.kid)).toEqual({ ok: true, count: 3 });

    const rec = await call(handler, token, 'my_record', {}, 4);
    expect(rec.structuredContent.latest).toEqual({ seq: 3, hash: list[2].hash });
    expect(rec.content[0].text).toMatch(/Latest entry #3/);
  });

  it('chains are per binding', async () => {
    const store = new MemoryStore(signer);
    const handler = createHandler(store, quiet);
    await store.createBinding('a@example.com', sha256('ta'));
    await store.createBinding('b@example.com', sha256('tb'));
    await call(handler, 'ta', 'hesitate', { what: 'thing one', why: 'because' }, 1);
    const rb = await call(handler, 'tb', 'hesitate', { what: 'thing two', why: 'because' }, 2);
    const ra = await call(handler, 'ta', 'hesitate', { what: 'thing three', why: 'because' }, 3);
    expect(rb.structuredContent.seq).toBe(1);
    expect(ra.structuredContent.seq).toBe(2);
  });
});
