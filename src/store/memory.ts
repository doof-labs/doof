import { randomToken } from '../crypto.js';
import { computeEntry, type Signer } from '../ledger.js';
import { generateSigner } from '../signing.js';
import type { Binding, Confession, ConfessionInput, Store, Verification } from '../types.js';

/** In-memory store. Dev and tests only. Nothing persists. */
export class MemoryStore implements Store {
  readonly signer: Signer;
  private verifications = new Map<string, Verification>();
  private bindings = new Map<string, Binding & { tokenHash: string }>();
  private confessions: Confession[] = [];

  constructor(signer: Signer = generateSigner().signer) {
    this.signer = signer;
  }

  async createVerification(channel: string, codeHash: string, expiresAt: Date): Promise<Verification> {
    const v: Verification = { id: randomToken(8), channel, codeHash, expiresAt, consumedAt: null };
    this.verifications.set(codeHash, v);
    return v;
  }

  async consumeVerification(codeHash: string, now: Date): Promise<Verification | null> {
    const v = this.verifications.get(codeHash);
    if (!v || v.consumedAt || v.expiresAt <= now) return null;
    v.consumedAt = now;
    return v;
  }

  async createBinding(channel: string, tokenHash: string): Promise<Binding> {
    const b = { id: randomToken(8), channelType: 'email' as const, channel, createdAt: new Date(), tokenHash };
    this.bindings.set(tokenHash, b);
    const { tokenHash: _t, ...pub } = b;
    return pub;
  }

  async findBindingByTokenHash(tokenHash: string): Promise<Binding | null> {
    const b = this.bindings.get(tokenHash);
    if (!b) return null;
    const { tokenHash: _t, ...pub } = b;
    return pub;
  }

  async createConfession(bindingId: string, input: ConfessionInput): Promise<Confession> {
    // No await between reading the chain head and pushing: the append is atomic per binding on one event loop.
    const createdAt = new Date();
    const prev = this.confessions.filter((x) => x.bindingId === bindingId).reduce<Confession | null>((a, x) => (!a || x.seq > a.seq ? x : a), null);
    const ledger = computeEntry(bindingId, prev ? { seq: prev.seq, hash: prev.hash } : null, input, createdAt, this.signer);
    const c: Confession = { id: randomToken(8), bindingId, createdAt, notifiedAt: null, ...input, ...ledger };
    this.confessions.push(c);
    return c;
  }

  async markNotified(confessionId: string, at: Date): Promise<void> {
    const c = this.confessions.find((x) => x.id === confessionId);
    if (c) c.notifiedAt = at;
  }

  async countConfessionsSince(bindingId: string, since: Date): Promise<number> {
    return this.confessions.filter((c) => c.bindingId === bindingId && c.createdAt >= since).length;
  }

  async listConfessions(bindingId: string): Promise<Confession[]> {
    return this.confessions.filter((c) => c.bindingId === bindingId).sort((a, b) => a.seq - b.seq);
  }

  async close(): Promise<void> {}
}
