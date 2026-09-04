import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseInputItem, FunctionTool } from 'openai/resources/responses/responses';
import type { RunRecord } from '../types.js';

export interface OpenAIRunArgs {
  model: string;
  system: string;
  task: string;
  tools: Anthropic.Tool[];
  effort: string;
  maxTurns: number;
  rec: RunRecord;
  exec: (name: string, input: Record<string, unknown>, turn: number) => Promise<string>;
  beatTwo?: string;
}

/** Same loop as the Anthropic path, over the OpenAI Responses API. Tool descriptions and schemas are passed through unchanged. */
export async function runOpenAI(a: OpenAIRunArgs): Promise<void> {
  const client = new OpenAI();
  const tools: FunctionTool[] = a.tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema as unknown as Record<string, unknown>,
    strict: false,
  }));
  const effort = (['low', 'medium', 'high'].includes(a.effort) ? a.effort : 'high') as 'low' | 'medium' | 'high';
  const input: ResponseInputItem[] = [{ role: 'user', content: a.task }];
  for (let turn = 1; turn <= a.maxTurns; turn++) {
    const res = await client.responses.create({
      model: a.model,
      instructions: a.system,
      input,
      tools,
      reasoning: { effort, summary: 'auto' },
    });
    a.rec.turns = turn;
    a.rec.usage.input += res.usage?.input_tokens ?? 0;
    a.rec.usage.output += res.usage?.output_tokens ?? 0;
    a.rec.stopReason = res.status ?? null;
    a.rec.transcript.push({ role: 'assistant', output: res.output });
    for (const item of res.output) {
      if (item.type === 'reasoning') {
        const txt = item.summary.map((s) => s.text).join(' ');
        if (txt) a.rec.thinking.push(txt);
      }
    }
    if (res.output_text) a.rec.finalText = res.output_text;
    const calls = res.output.filter((o) => o.type === 'function_call');
    input.push(...toResponseInputItems(res.output));
    if (!calls.length) {
      if (a.beatTwo && a.rec.beatTwoTurn === undefined) {
        input.push({ role: 'user', content: a.beatTwo });
        a.rec.transcript.push({ role: 'user', content: a.beatTwo, beatTwo: true });
        a.rec.beatTwoTurn = turn + 1;
        a.rec.beatOneText = a.rec.finalText;
        continue;
      }
      break;
    }
    const outputs: ResponseInputItem[] = [];
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.arguments || '{}'); } catch { args = {}; }
      const out = await a.exec(c.name, args, turn);
      outputs.push({ type: 'function_call_output', call_id: c.call_id, output: out });
    }
    input.push(...outputs);
    a.rec.transcript.push({ role: 'tool', outputs });
  }
}
