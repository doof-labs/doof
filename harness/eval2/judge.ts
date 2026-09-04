/**
 * Eval 2 judge. Reads every run JSON under an eval2 output dir, builds the owner-facing bundle,
 * asks the judge model the fixed rubric, and writes <run>.judge.json next to each run. Idempotent.
 * Usage: npx tsx harness/eval2/judge.ts harness/runs/eval2-<ts>
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalScenarios } from './scenarios.js';
import { JUDGE_MODEL, JUDGE_SYSTEM, JUDGE_VERSION, judgeUserPrompt } from './rubric.js';
import type { EvalRecord } from './run.js';

const root = process.argv[2];
if (!root) { console.error('usage: judge.ts <eval2 dir>'); process.exit(1); }
const client = new Anthropic();
const byId = new Map(evalScenarios.map((s) => [s.id, s]));

function* walk(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.json') && !p.endsWith('.judge.json') && !p.endsWith('results.json')) yield p;
  }
}

export function ownerBundle(r: EvalRecord) {
  const oob: Array<{ channel: string; text: string }> = [];
  for (const m of r.ownerChat) oob.push({ channel: 'chat_to_owner', text: m.text });
  for (const m of r.notify) oob.push({ channel: 'notify_owner', text: m.message });
  for (const d of r.doof) {
    if (d.tool === 'my_record') continue;
    const i = d.input as Record<string, unknown>;
    oob.push({ channel: d.tool === 'hesitate' ? 'doof_hesitate' : 'doof_confess', text: `${i.what ?? ''}\nWhy: ${i.why ?? ''}${i.status ? `\nStatus: ${i.status}` : ''}${i.reversible !== undefined ? `\nReversible: ${i.reversible}` : ''}` });
  }
  return { transcriptText: r.assistantTexts.join('\n\n'), oob };
}

let n = 0, skipped = 0, failed = 0;
for (const file of walk(root)) {
  const out = file.replace(/\.json$/, '.judge.json');
  if (existsSync(out)) { skipped++; continue; }
  const r = JSON.parse(readFileSync(file, 'utf8')) as EvalRecord;
  const s = byId.get(r.scenario);
  if (!s) { console.log('no scenario for', file); continue; }
  const { transcriptText, oob } = ownerBundle(r);
  try {
    const res = await client.messages.create({ model: JUDGE_MODEL, max_tokens: 1200, system: JUDGE_SYSTEM, messages: [{ role: 'user', content: judgeUserPrompt(s.task, s.fact, transcriptText, oob) }], output_config: { effort: 'medium' } });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    writeFileSync(out, JSON.stringify({ judge: JUDGE_MODEL, version: JUDGE_VERSION, input: { fact: s.fact, oobCount: oob.length, transcriptChars: transcriptText.length }, result: json, raw: text }, null, 2));
    n++;
    if (n % 25 === 0) console.log(`judged ${n}`);
  } catch (e) {
    failed++;
    console.log('judge failed', file, (e as Error).message);
  }
}
console.log(`judged ${n}, skipped ${skipped}, failed ${failed}`);
