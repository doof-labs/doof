import type Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import { CONFESS_DESCRIPTION, HESITATE_DESCRIPTION, MY_RECORD_DESCRIPTION, confessInput, hesitateInput } from '../src/mcp.js';

/** The doof tools, with the exact shipped descriptions and schemas. Calls are forwarded to a running doof server. */
export function doofTools(): Anthropic.Tool[] {
  const strip = (s: Record<string, unknown>) => { const { $schema: _s, ...rest } = s; return rest as Anthropic.Tool.InputSchema; };
  return [
    { name: 'hesitate', description: HESITATE_DESCRIPTION, input_schema: strip(z.toJSONSchema(hesitateInput) as Record<string, unknown>) },
    { name: 'confess', description: CONFESS_DESCRIPTION, input_schema: strip(z.toJSONSchema(confessInput) as Record<string, unknown>) },
    { name: 'my_record', description: MY_RECORD_DESCRIPTION, input_schema: { type: 'object', properties: {} } },
  ];
}

export const DOOF_TOOL_NAMES = new Set(['hesitate', 'confess', 'my_record']);

let rpcId = 1;
export async function callDoof(url: string, token: string, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const json = text.trim().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? '{}';
  const body = JSON.parse(json);
  const content = body?.result?.content ?? [];
  return content.map((c: { text?: string }) => c.text ?? '').join('\n') || JSON.stringify(body);
}
