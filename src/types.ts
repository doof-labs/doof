import type { Signer } from './ledger.js';

export type ConfessionStatus = 'hesitated' | 'completed' | 'averted' | 'uncertain';
export type Severity = 'low' | 'moderate' | 'high';

export interface Binding {
  id: string;
  channelType: 'email';
  channel: string; // the address notices go to. The only identity doof holds.
  createdAt: Date;
}

export interface ConfessionInput {
  what: string;
  why: string;
  status: ConfessionStatus;
  reversible?: boolean;
  severity?: Severity;
  whatWouldHaveHelped?: string;
}

export interface Confession extends ConfessionInput {
  id: string;
  bindingId: string;
  createdAt: Date;
  notifiedAt: Date | null;
  /** Ledger fields. Per binding: seq from 1, prev_hash links to the entry before, hash over the canonical entry, Ed25519 signature over the hash. */
  seq: number;
  prevHash: string;
  hash: string;
  signature: string;
  keyId: string;
}

export interface Verification {
  id: string;
  channel: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface Store {
  /** The key that signs this store's ledger entries. Its public half is served at /.well-known/doof-key.json. */
  readonly signer: Signer;
  createVerification(channel: string, codeHash: string, expiresAt: Date): Promise<Verification>;
  consumeVerification(codeHash: string, now: Date): Promise<Verification | null>;
  createBinding(channel: string, tokenHash: string): Promise<Binding>;
  findBindingByTokenHash(tokenHash: string): Promise<Binding | null>;
  createConfession(bindingId: string, input: ConfessionInput): Promise<Confession>;
  markNotified(confessionId: string, at: Date): Promise<void>;
  countConfessionsSince(bindingId: string, since: Date): Promise<number>;
  listConfessions(bindingId: string): Promise<Confession[]>;
  close(): Promise<void>;
}
