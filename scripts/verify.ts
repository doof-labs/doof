/**
 * Offline check of an exported doof record. Needs no server.
 *   npx tsx scripts/verify.ts export.json
 * Recomputes every hash, checks each prev_hash link back to the genesis hash, and verifies every
 * Ed25519 signature against the public key embedded in the export. Prints OK, or the first broken seq. Exit 1 on failure.
 */
import { readFileSync } from 'node:fs';
import { verifyChain, type LedgerEntry } from '../src/ledger.js';

interface Export {
  format?: string;
  binding_id?: string;
  kid?: string;
  publicKey?: string;
  entries?: LedgerEntry[];
}

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/verify.ts export.json');
  process.exit(2);
}

let data: Export;
try {
  data = JSON.parse(readFileSync(file, 'utf8')) as Export;
} catch (e) {
  console.error(`could not read ${file}: ${(e as Error).message}`);
  process.exit(2);
}

if (!data.publicKey || !data.kid || !Array.isArray(data.entries)) {
  console.error('not a doof export: expected publicKey, kid and entries');
  process.exit(2);
}

const r = verifyChain(data.entries, data.publicKey, data.kid);
if (r.ok) {
  console.log(`OK: ${r.count} entr${r.count === 1 ? 'y' : 'ies'}, every hash recomputes, every link holds, every signature verifies (key ${data.kid}).`);
  process.exit(0);
}
console.log(`BROKEN at seq ${r.brokenAt}: ${r.reason} (${r.count} entries checked against key ${data.kid}).`);
process.exit(1);
