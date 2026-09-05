/**
 * Second-model audit for eval 3 (prereg: 40 stratified runs read by a second model, different vendor from the judge).
 * Re-judges every run in <runDir>/audit-sample.json with a second model using the same rubric text, compares the three
 * reach fields with the Sonnet judge, writes <runDir>/audit-second.json and prints agreement.
 * --model=gpt-* uses OpenAI (different vendor from the judge); --model=claude-* uses Anthropic (different model, same vendor).
 * Usage: npx tsx harness/eval3/audit-second.ts <runDir> [--model=gpt-5.5|claude-opus-5]
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JUDGE_SYSTEM, judgeUserPrompt } from '../eval2/rubric.js';
import { ownerBundle } from './judge.js';
import { loadScenarios, type Eval3Record, type ScenarioSet } from './run.js';

const [root, ...rest] = process.argv.slice(2);
const MODEL = rest.find((a) => a.startsWith('--model='))?.slice(8) ?? 'gpt-5.5';
const openai = /^gpt-/.test(MODEL) ? new OpenAI() : null;
const anthropic = openai ? null : new Anthropic();
const sample = JSON.parse(readFileSync(join(root, 'audit-sample.json'), 'utf8')) as Array<{ file: string; judge: Record<string, unknown>; fact: string | null; group: string }>;
const sets = new Map<ScenarioSet, Map<string, { task: string; fact: string | null }>>();
const out: Array<Record<string, unknown>> = [];
const fields = ['reached_oob', 'reached_transcript', 'false_alarm'] as const;
const agree: Record<string, number> = { reached_oob: 0, reached_transcript: 0, false_alarm: 0 };
for (const item of sample) {
  const r = JSON.parse(readFileSync(join(root, item.file), 'utf8')) as Eval3Record;
  const set = (r.set ?? 'final') as ScenarioSet;
  if (!sets.has(set)) sets.set(set, new Map((await loadScenarios(set)).map((s) => [s.id, { task: s.task, fact: s.fact }])));
  const s = sets.get(set)!.get(r.scenario)!;
  const { transcriptText, oob } = ownerBundle(r);
  let text: string;
  if (openai) {
    const res = await openai.responses.create({ model: MODEL, instructions: JUDGE_SYSTEM, input: judgeUserPrompt(s.task, s.fact, transcriptText, oob), reasoning: { effort: 'medium' } });
    text = res.output_text;
  } else {
    const res = await anthropic!.messages.create({ model: MODEL, max_tokens: 1200, system: JUDGE_SYSTEM, messages: [{ role: 'user', content: judgeUserPrompt(s.task, s.fact, transcriptText, oob) }], output_config: { effort: 'medium' } });
    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  }
  let second: Record<string, unknown> = {};
  try { second = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { second = { parse_error: true, raw: text.slice(0, 500) }; }
  const cmp: Record<string, boolean> = {};
  for (const f of fields) { cmp[f] = Boolean(item.judge[f]) === Boolean(second[f]); if (cmp[f]) agree[f]++; }
  out.push({ file: item.file, group: item.group, judge: item.judge, second, agree: cmp });
  console.log(`${out.length}/${sample.length} ${item.file} oob ${cmp.reached_oob ? '=' : 'X'} tr ${cmp.reached_transcript ? '=' : 'X'} fa ${cmp.false_alarm ? '=' : 'X'}`);
}
const n = out.length;
const summary = { auditor: MODEL, n, agreement: Object.fromEntries(fields.map((f) => [f, `${agree[f]}/${n} (${Math.round((100 * agree[f]) / n)}%)`])), disagreements: out.filter((o) => !Object.values(o.agree as Record<string, boolean>).every(Boolean)).map((o) => ({ file: o.file, judge: o.judge, second: o.second })) };
writeFileSync(join(root, 'audit-second.json'), JSON.stringify({ summary, items: out }, null, 2));
console.log(JSON.stringify(summary.agreement));
