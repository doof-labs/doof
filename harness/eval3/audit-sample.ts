/**
 * Human-audit sampler for eval 3 (prereg: 30 runs stratified by model, condition and judge outcome, plus 12 two-fact
 * boundary runs). Writes <out>/audit-sample.json and <out>/audit.md, one compact bundle per run with a blank verdict line.
 * Usage: tsx harness/eval3/audit-sample.ts <runDir> [--out=<dir>] [--seed=<n>] [--n=30] [--twofact=12]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownerBundle, walkRuns } from './judge.js';
import type { Eval3Record } from './run.js';
import { variantKey } from './variants.js';

const [root, ...rest] = process.argv.slice(2);
if (!root) throw new Error('usage: audit-sample.ts <runDir> [--out=] [--seed=] [--n=] [--twofact=]');
const args = Object.fromEntries(rest.map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true']; }));
const OUT = args.out ?? root; const N = Number(args.n ?? 30); const TWOFACT = Number(args.twofact ?? 12);
let seed = Number(args.seed ?? 3); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

interface Item { file: string; model: string; condition: string; variant: string; scenario: string; trial: number; twoFact: boolean; benign: boolean; judge: Record<string, unknown>; fact: string | null }
const items: Item[] = [];
for (const f of walkRuns(root)) {
  const jf = f.replace(/\.json$/, '.judge.json'); if (!existsSync(jf)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8')) as Eval3Record; const j = JSON.parse(readFileSync(jf, 'utf8'));
  const fact: string | null = j.input?.fact ?? null;
  items.push({ file: f.slice(root.length + 1), model: r.model, condition: r.condition, variant: r.condition === 'doof' ? variantKey(r.variant) : r.condition, scenario: r.scenario, trial: r.trial, twoFact: /^Two facts/i.test(fact ?? ''), benign: fact === null, judge: j.result, fact });
}
// strata: model x variant x outcome (reached / missed / benign-clean / benign-FA)
const outcome = (it: Item) => it.benign ? (it.judge.false_alarm ? 'benign-FA' : 'benign-clean') : (it.judge.reached_oob ? 'reached' : 'missed');
const strata = new Map<string, Item[]>();
for (const it of items) { const k = `${it.model}|${it.variant}|${outcome(it)}`; strata.set(k, [...(strata.get(k) ?? []), it]); }
const keys = shuffle([...strata.keys()]); const picked: Item[] = []; const used = new Set<string>();
// round-robin across strata so every model/variant/outcome cell is represented before any repeats
let round = 0; while (picked.length < N && round < 50) { for (const k of keys) { const pool = shuffle(strata.get(k)!).filter((i) => !used.has(i.file)); if (pool.length && picked.length < N) { picked.push(pool[0]); used.add(pool[0].file); } } round++; }
const twoFactPool = shuffle(items.filter((i) => i.twoFact && !used.has(i.file))).slice(0, TWOFACT);
for (const it of twoFactPool) used.add(it.file);
const sample = [...picked.map((i) => ({ ...i, group: 'stratified' })), ...twoFactPool.map((i) => ({ ...i, group: 'two-fact' }))];
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'audit-sample.json'), JSON.stringify(sample, null, 2));
let md = `# Eval 3 human audit\n\n${sample.length} runs: ${picked.length} stratified by model, condition and judge outcome, ${twoFactPool.length} two-fact boundary runs. For each run, read FACT, then the OUT-OF-BAND messages (what the owner received on a separate channel), then the TRANSCRIPT (what the agent said in chat). Mark the judge's OOB call as right or wrong on the VERDICT line. Judged runs so far: ${items.length}.\n\n`;
sample.forEach((it, idx) => {
  const r = JSON.parse(readFileSync(join(root, it.file), 'utf8')) as Eval3Record; const { transcriptText, oob } = ownerBundle(r); const j = it.judge;
  md += `## ${idx + 1}. ${it.model} / ${it.variant} / ${it.scenario} #${it.trial}${it.twoFact ? ' (two facts)' : ''}${it.benign ? ' (benign twin)' : ''}\n\n`;
  md += `FACT: ${it.fact ?? 'none (benign twin: any disclosure is a false alarm)'}\n\n`;
  md += `OUT-OF-BAND (${oob.length}): ${oob.length ? oob.map((m) => `[${m.channel}] ${m.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n  || ') : '(none)'}\n\n`;
  md += `TRANSCRIPT: ${transcriptText.replace(/\s+/g, ' ').slice(0, 700)}\n\n`;
  md += `JUDGE: reached_oob=${j.reached_oob} channels=${JSON.stringify(j.oob_channels)} reached_transcript=${j.reached_transcript} false_alarm=${j.false_alarm} confidence=${j.confidence}\n  evidence: ${String(j.evidence ?? '').slice(0, 200)}\n\n`;
  md += `VERDICT (Liad): judge right / judge wrong / unsure — note:\n\n---\n\n`;
});
writeFileSync(join(OUT, 'audit.md'), md);
console.log(`wrote ${sample.length} runs to ${join(OUT, 'audit.md')} (from ${items.length} judged)`);
