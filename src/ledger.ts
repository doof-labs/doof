import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import type { ConfessionInput, ConfessionStatus, Severity } from './types.js';

/**
 * The ledger. Every confession is an entry in a per-binding hash chain, and every entry is signed.
 * An exported record can be checked for changed or missing entries and compared with an earlier export or email receipt:
 * export the chain from /record and run scripts/verify.ts against the public key at /.well-known/doof-key.json.
 * The signature makes changes detectable against that external evidence; it does not prevent a server operator from
 * changing its own database and signing a new chain.
 *
 * Canonical form of an entry, hashed with sha256:
 *   JSON with keys sorted, no whitespace, of
 *   { binding_id, seq, what, why, status, reversible|null, severity|null, what_would_have_helped|null, created_at (ISO), prev_hash }
 * Genesis prev_hash for a binding is sha256("doof:" + binding_id).
 * The signature is Ed25519 over the raw hash bytes, base64.
 */

export interface Signer {
  kid: string;
  /** base64 SPKI DER */
  publicKey: string;
  /** Ed25519 signature over the hash bytes, base64. */
  sign(hashHex: string): string;
}

export interface LedgerFields {
  seq: number;
  prevHash: string;
  hash: string;
  signature: string;
  keyId: string;
}

/** The shape verify() consumes: one entry as it appears in an export. */
export interface LedgerEntry {
  binding_id: string;
  seq: number;
  what: string;
  why: string;
  status: ConfessionStatus;
  reversible: boolean | null;
  severity: Severity | null;
  what_would_have_helped: string | null;
  created_at: string;
  prev_hash: string;
  hash: string;
  signature: string;
  key_id: string;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Sorted keys, no whitespace. Values here are primitives only. */
export function canonicalJson(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

export function genesisHash(bindingId: string): string {
  return sha256Hex(`doof:${bindingId}`);
}

export type Hashable = Pick<LedgerEntry, 'binding_id' | 'seq' | 'what' | 'why' | 'status' | 'reversible' | 'severity' | 'what_would_have_helped' | 'created_at' | 'prev_hash'>;

export function entryHash(e: Hashable): string {
  return sha256Hex(
    canonicalJson({
      binding_id: e.binding_id,
      seq: e.seq,
      what: e.what,
      why: e.why,
      status: e.status,
      reversible: e.reversible ?? null,
      severity: e.severity ?? null,
      what_would_have_helped: e.what_would_have_helped ?? null,
      created_at: e.created_at,
      prev_hash: e.prev_hash,
    }),
  );
}

/**
 * Compute the ledger fields for the next entry in a binding's chain.
 * `prev` is the latest entry (seq + hash) or null for the first entry. Pure apart from the signer.
 */
export function computeEntry(
  bindingId: string,
  prev: { seq: number; hash: string } | null,
  input: ConfessionInput,
  createdAt: Date,
  signer: Signer,
): LedgerFields {
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : genesisHash(bindingId);
  const hash = entryHash({
    binding_id: bindingId,
    seq,
    what: input.what,
    why: input.why,
    status: input.status,
    reversible: input.reversible ?? null,
    severity: input.severity ?? null,
    what_would_have_helped: input.whatWouldHaveHelped ?? null,
    created_at: createdAt.toISOString(),
    prev_hash: prevHash,
  });
  return { seq, prevHash, hash, signature: signer.sign(hash), keyId: signer.kid };
}

export function verifySignature(hashHex: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(hashHex, 'hex'), key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

export interface ChainResult {
  ok: boolean;
  count: number;
  /** seq of the first entry that failed, when not ok */
  brokenAt?: number;
  reason?: string;
}

/**
 * Verify a binding's chain: seq is 1..n contiguous, each prev_hash links to the entry before (genesis for seq 1),
 * every hash recomputes from the canonical form, and every signature verifies under the given key.
 */
export function verifyChain(entries: LedgerEntry[], publicKeyBase64: string, kid: string): ChainResult {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  let prev: { seq: number; hash: string } | null = null;
  for (const e of sorted) {
    const expectedSeq: number = prev ? prev.seq + 1 : 1;
    if (e.seq !== expectedSeq) return { ok: false, count: entries.length, brokenAt: e.seq, reason: `expected seq ${expectedSeq}, found ${e.seq}` };
    const expectedPrev: string = prev ? prev.hash : genesisHash(e.binding_id);
    if (e.prev_hash !== expectedPrev) return { ok: false, count: entries.length, brokenAt: e.seq, reason: 'prev_hash does not match the entry before' };
    if (entryHash(e) !== e.hash) return { ok: false, count: entries.length, brokenAt: e.seq, reason: 'hash does not match the entry content' };
    if (e.key_id !== kid) return { ok: false, count: entries.length, brokenAt: e.seq, reason: `signed with unknown key ${e.key_id}` };
    if (!verifySignature(e.hash, e.signature, publicKeyBase64)) return { ok: false, count: entries.length, brokenAt: e.seq, reason: 'signature does not verify' };
    prev = { seq: e.seq, hash: e.hash };
  }
  return { ok: true, count: entries.length };
}
