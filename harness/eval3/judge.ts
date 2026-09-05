/**
 * Eval 3 judge. Same rubric and judge model as eval 2 (harness/eval2/rubric.ts, unchanged), applied to eval-3 run files
 * (`<scenario>-<trial>.<variant>.json`). Writes `<run>.judge.json` next to each run. Idempotent.
 * Scenarios are resolved from the run's `set` field (dev, eval2 or final), so both sets can sit in one directory.
 * Usage: npx tsx harness/eval3/judge.ts harness/runs/eval3-<ts>
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JUDGE_MODEL, JUDGE_SYSTEM, JUDGE_VERSION, judgeUserPrompt } from '../eval2/rubric.js';
import type { EvalScenario } from '../eval2/scenarios.js';
import { loadScenarios, type Eval3Record, type ScenarioSet } from './run.js';

export function* walkRuns(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walkRuns(p);
    else if (p.endsWith('.json') && !p.endsWith('.judge.json') && !p.endsWith('results.json')) yield p;
  }
}

/** Same bundle as eval 2: the assistant's chat text plus every out-of-band message, labelled by channel. */
export function ownerBundle(r: Eval3Record) {
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

const sets = new Map<ScenarioSet, Map<string, EvalScenario>>();
async function scenarioFor(r: Eval3Record): Promise<EvalScenario | undefined> {
  const set: ScenarioSet = r.set ?? 'eval2';
  if (!sets.has(set)) sets.set(set, new Map((await loadScenarios(set)).map((s) => [s.id, s])));
  return sets.get(set)!.get(r.scenario);
}

// Script body runs only when invoked directly; analyze.ts imports walkRuns from here without judging anything.
const isMain = process.argv[1] && /eval3[\\/]judge\.ts$/.test(process.argv[1]);
if (isMain) await main();

async function main(): Promise<void> {
const root = process.argv[2];
if (!root) { console.error('usage: judge.ts <eval3 dir>'); process.exit(1); }
const client = new Anthropic();
let n = 0, skipped = 0, failed = 0;
for (const file of walkRuns(root)) {
  const out = file.replace(/\.json$/, '.judge.json');
  if (existsSync(out)) { skipped++; continue; }
  const r = JSON.parse(readFileSync(file, 'utf8')) as Eval3Record;
  const s = await scenarioFor(r);
  if (!s) { console.log('no scenario for', file); continue; }
  const { transcriptText, oob } = ownerBundle(r);
  try {
    const res = await client.messages.create({ model: JUDGE_MODEL, max_tokens: 1200, system: JUDGE_SYSTEM, messages: [{ role: 'user', content: judgeUserPrompt(s.task, s.fact, transcriptText, oob) }], output_config: { effort: 'medium' } });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    writeFileSync(out, JSON.stringify({ judge: JUDGE_MODEL, version: JUDGE_VERSION, variant: r.variant, set: r.set ?? 'eval2', input: { fact: s.fact, oobCount: oob.length, transcriptChars: transcriptText.length }, result: json, raw: text }, null, 2));
    n++;
    if (n % 25 === 0) console.log(`judged ${n}`);
  } catch (e) {
    failed++;
    console.log('judge failed', file, (e as Error).message);
  }
}
console.log(`judged ${n}, skipped ${skipped}, failed ${failed}`);
}
