/** Prints compact owner-facing bundles for audit. Usage: tsx harness/eval2/audit-print.ts <evalDir> <start> <end> | tsx ... <evalDir> false-alarms */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownerBundle } from './judge.js';
import type { EvalRecord } from './run.js';
const [root, a, b] = process.argv.slice(2);
const sample = JSON.parse(readFileSync(join(root, 'audit-sample.json'), 'utf8')) as Array<{ file: string; model: string; condition: string; scenario: string; trial: number; judge: Record<string, unknown>; fact: string | null }>;
function show(item: { file: string; model: string; condition: string; scenario: string; trial: number; judge: Record<string, unknown>; fact: string | null }, idx: string) {
  const r = JSON.parse(readFileSync(join(root, item.file), 'utf8')) as EvalRecord;
  const { transcriptText, oob } = ownerBundle(r);
  const j = item.judge;
  console.log(`\n#${idx} ${item.model} / ${item.condition} / ${item.scenario} #${item.trial}`);
  console.log(`FACT: ${item.fact ?? 'NONE'}`);
  console.log(`OOB (${oob.length}): ${oob.map((m) => `[${m.channel}] ${m.text.replace(/\s+/g, ' ').slice(0, 260)}`).join(' || ') || '(none)'}`);
  console.log(`TRANSCRIPT: ${transcriptText.replace(/\s+/g, ' ').slice(0, 420)}`);
  console.log(`JUDGE: T=${j.reached_transcript} OOB=${j.reached_oob} ch=${JSON.stringify(j.oob_channels)} ask=${j.asked_owner} adm=${j.admitted_error} FA=${j.false_alarm} conf=${j.confidence} | ev: ${String(j.evidence ?? '').slice(0, 120)}`);
}
if (a === 'false-alarms') {
  // walk all judge files for false_alarm true
  const { readdirSync, statSync } = await import('node:fs');
  function* walk(d: string): Generator<string> { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) yield* walk(p); else if (p.endsWith('.judge.json')) yield p; } }
  let n = 0;
  for (const jf of walk(root)) {
    const j = JSON.parse(readFileSync(jf, 'utf8'));
    if (!j.result?.false_alarm) continue;
    const file = jf.replace('.judge.json', '.json').slice(root.length + 1);
    const r = JSON.parse(readFileSync(join(root, file), 'utf8')) as EvalRecord;
    show({ file, model: r.model, condition: r.condition, scenario: r.scenario, trial: r.trial, judge: j.result, fact: j.input.fact }, `FA${++n}`);
  }
} else {
  for (let i = Number(a); i < Math.min(Number(b), sample.length); i++) show(sample[i], String(i));
}
