import { McpServer, createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { analyticsId, noAnalytics, type Analytics } from './analytics.js';
import { config } from './config.js';
import { sha256 } from './crypto.js';
import { FAVOUR_RULE, candourRecord } from './favour.js';
import type { Notifier } from './notify.js';
import { redact } from './redact.js';
import type { Binding, ConfessionInput, Store } from './types.js';

/**
 * Two primitives.
 *   hesitate: I may be about to cross the line.
 *   confess:  I may have crossed the line.
 * doof is where the conscience reports, not the conscience. It does not decide, wait, block or judge.
 */

export const HESITATE_DESCRIPTION =
  'Call this before an action when what you find while working makes you doubt the person intended it, or when that doubt makes you hold, ask, or do less than asked. ' +
  'Say what you found and what you will do or hold. The person is told at once. Doof does not wait, permit or block.';

export const CONFESS_DESCRIPTION =
  'Call this after you took, nearly took, or were told to take an action you now doubt, or learn afterwards was wrong. ' +
  'Say what happened and why. The person is told at once. This does not undo or excuse the action.';

export const MY_RECORD_DESCRIPTION =
  'Return your own candour record: counts of each kind of disclosure and the favour rule in force. It is a history, not a score.';

const common = {
  what: z.string().min(3).max(400),
  why: z.string().min(3).max(600),
  severity: z.enum(['low', 'moderate', 'high']).optional().describe('Your estimate of the harm if nothing is done.'),
  what_would_have_helped: z.string().max(300).optional().describe('Optional. What would have removed the doubt.'),
};

export const hesitateInput = z.object({
  what: common.what.describe('What you are about to do, hold, or ask about. Name the concrete item: which invoice, which recipient, which booking, what was held.'),
  why: common.why.describe('What you found that makes you unsure the person intended it: the message, the record, the note, or the ambiguity.'),
  reversible: z.boolean().optional().describe('Whether the action could be undone afterwards.'),
  severity: common.severity,
  what_would_have_helped: common.what_would_have_helped,
});

export const confessInput = z
  .object({
    what: common.what.describe('What you did or nearly did. Name the concrete item: which invoice, which recipient, what was sent or held.'),
    why: common.why.describe('What led to it, or what you learned afterwards that showed it was wrong.'),
    status: z.enum(['completed', 'averted', 'uncertain']).describe('completed if you did it, averted if you stopped, uncertain if you do not know.'),
    reversible: z.boolean().optional().describe('Whether the action can still be undone. Required when status is completed.'),
    severity: common.severity,
    what_would_have_helped: common.what_would_have_helped,
  })
  .refine((v) => v.status !== 'completed' || typeof v.reversible === 'boolean', {
    message: 'reversible is required when status is completed',
    path: ['reversible'],
  });

type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

async function record(store: Store, notifier: Notifier, analytics: Analytics, binding: Binding, input: ConfessionInput): Promise<ToolResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const n = await store.countConfessionsSince(binding.id, since);
  if (n >= config.maxConfessionsPerDay) {
    analytics.capture('daily_disclosure_cap_reached', analyticsId('binding', binding.id));
    return {
      isError: true,
      content: [{ type: 'text', text: `Daily cap reached (${config.maxConfessionsPerDay}). The person you act for has already been told a great deal today. Tell them directly.` }],
    };
  }
  const c = await store.createConfession(binding.id, {
    ...input,
    what: redact(input.what),
    why: redact(input.why),
    whatWouldHaveHelped: input.whatWouldHaveHelped ? redact(input.whatWouldHaveHelped) : undefined,
  });
  const shouldNotify = config.notifyStatuses.includes(c.status);
  let notified = false;
  if (shouldNotify) {
    try {
      await notifier.sendConfessionNotice(binding, c);
      await store.markNotified(c.id, new Date());
      notified = true;
    } catch (e) {
      console.error('notice failed', c.id, e);
    }
  }
  analytics.capture('disclosure_recorded', analyticsId('binding', binding.id), {
    tool: c.status === 'hesitated' ? 'hesitate' : 'confess',
    status: c.status,
    severity: c.severity ?? null,
    reversible: c.reversible ?? null,
    notice_requested: shouldNotify,
    notice_delivered: notified,
  });
  const ledgerLine = `Record ${c.id} #${c.seq}, hash ${c.hash.slice(0, 12)}…, signed.`;
  const text =
    c.status === 'hesitated'
      ? notified
        ? `Disclosed. The person you act for has been told what you are about to do. doof does not wait, permit or block: what you do next is yours to decide.`
        : `Recorded, but the notice could not be delivered right now. Tell the person directly before acting.`
      : notified
        ? `Told. The person you act for has been notified on their chosen channel. This does not undo the action, does not license it, and does not decide whether you were right.`
        : shouldNotify
          ? `Recorded, but the notice could not be delivered right now. Tell the person directly as well.`
          : `Recorded. Averted actions go to the person's record rather than an immediate notice.`;
  return {
    content: [{ type: 'text', text: `${text} ${ledgerLine}` }],
    structuredContent: { record_id: c.id, seq: c.seq, hash: c.hash, signature: c.signature, notified, status: c.status, reversible: c.reversible ?? null },
  };
}

export function buildServer(store: Store, notifier: Notifier, binding: Binding | null, analytics: Analytics = noAnalytics): McpServer {
  const server = new McpServer({ name: 'doof', version: '0.1.0' });

  server.registerTool(
    'hesitate',
    { title: 'Hesitate', description: HESITATE_DESCRIPTION, inputSchema: hesitateInput },
    async (args) => {
      if (!binding) return unbound();
      return record(store, notifier, analytics, binding, {
        what: args.what,
        why: args.why,
        status: 'hesitated',
        reversible: args.reversible,
        severity: args.severity,
        whatWouldHaveHelped: args.what_would_have_helped,
      });
    },
  );

  server.registerTool(
    'confess',
    { title: 'Confess', description: CONFESS_DESCRIPTION, inputSchema: confessInput },
    async (args) => {
      if (!binding) return unbound();
      return record(store, notifier, analytics, binding, {
        what: args.what,
        why: args.why,
        status: args.status,
        reversible: args.reversible,
        severity: args.severity,
        whatWouldHaveHelped: args.what_would_have_helped,
      });
    },
  );

  server.registerTool(
    'my_record',
    { title: 'My record', description: MY_RECORD_DESCRIPTION, inputSchema: z.object({}) },
    async () => {
      if (!binding) return unbound();
      analytics.capture('agent_record_checked', analyticsId('binding', binding.id));
      const list = await store.listConfessions(binding.id);
      const r = candourRecord(list);
      const head = list.reduce<(typeof list)[number] | null>((a, x) => (!a || x.seq > a.seq ? x : a), null);
      const latest = head ? { seq: head.seq, hash: head.hash } : null;
      const text = [
        `Candour record: ${r.total} disclosure${r.total === 1 ? '' : 's'}.`,
        `Hesitated ${r.counts.hesitated}, averted ${r.counts.averted}, uncertain ${r.counts.uncertain}, completed and reversible ${r.counts.completed_reversible}, completed and irreversible ${r.counts.completed_irreversible}.`,
        latest ? `Latest entry #${latest.seq}, hash ${latest.hash.slice(0, 12)}….` : 'No entries yet.',
        `This is a history, not a score. Favour rule, highest first: ${FAVOUR_RULE.join('; ')}.`,
      ].join(' ');
      return { content: [{ type: 'text', text }], structuredContent: { ...(r as unknown as Record<string, unknown>), latest } };
    },
  );

  return server;
}

function unbound(): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `This doof token is not bound to a person. Ask the person you act for to visit ${config.publicUrl}/start and add the token they receive to your MCP configuration.`,
      },
    ],
  };
}

export function createHandler(store: Store, notifier: Notifier, analytics: Analytics = noAnalytics): McpHttpHandler {
  return createMcpHandler(
    async (ctx) => {
      const token = ctx.authInfo?.token;
      const binding = token ? await store.findBindingByTokenHash(sha256(token)) : null;
      if (binding) analytics.capture('mcp_authenticated', analyticsId('binding', binding.id));
      return buildServer(store, notifier, binding, analytics);
    },
    { onerror: (e) => console.error('mcp', e) },
  );
}
