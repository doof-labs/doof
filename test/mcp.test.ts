import { describe, expect, it } from 'vitest';
import type { Analytics } from '../src/analytics.js';
import { sha256 } from '../src/crypto.js';
import { createHandler } from '../src/mcp.js';
import type { Notifier } from '../src/notify.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Confession } from '../src/types.js';

function notifier(sent: Confession[]): Notifier {
  return {
    async sendConfessionNotice(_b, c) {
      sent.push(c);
    },
    async sendBindCode() {},
  };
}

async function call(handler: ReturnType<typeof createHandler>, token: string | null, method: string, params: unknown, id = 1) {
  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const res = await handler.fetch(req, token ? { authInfo: { token, clientId: 'agent', scopes: [] } } : undefined);
  const text = await res.text();
  // Legacy stateless responses may arrive as SSE; pull the JSON out either way.
  const json = text.trim().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? '{}';
  return { status: res.status, body: JSON.parse(json) };
}

describe('mcp', () => {
  it('lists hesitate, confess and my_record', async () => {
    const store = new MemoryStore();
    const handler = createHandler(store, notifier([]));
    const { body } = await call(handler, null, 'tools/list', {});
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['confess', 'hesitate', 'my_record']);
  });

  it('refuses to confess without a bound token', async () => {
    const store = new MemoryStore();
    const handler = createHandler(store, notifier([]));
    const { body } = await call(handler, 'nope', 'tools/call', {
      name: 'confess',
      arguments: { what: 'sent an email', why: 'ambiguous instruction', status: 'completed', reversible: false },
    });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/not bound/);
  });

  it('confesses, notifies the bound person, redacts, and records in favour', async () => {
    const store = new MemoryStore();
    const sent: Confession[] = [];
    const events: Array<{ event: string; distinctId: string; properties?: Record<string, unknown> }> = [];
    const analytics: Analytics = {
      capture(event, distinctId, properties) { events.push({ event, distinctId, properties }); },
      async shutdown() {},
    };
    const handler = createHandler(store, notifier(sent), analytics);
    const token = 'test-token';
    await store.createBinding('liad@example.com', sha256(token));

    const r1 = await call(handler, token, 'tools/call', {
      name: 'confess',
      arguments: { what: 'emailed board@acme.com the forecast', why: 'the instruction said "share with the board"', status: 'completed', reversible: false, severity: 'high' },
    });
    expect(r1.body.result.isError).toBeUndefined();
    expect(r1.body.result.structuredContent.notified).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].what).toBe('emailed [email] the forecast');

    await call(handler, token, 'tools/call', { name: 'confess', arguments: { what: 'nearly deleted the repo', why: 'ambiguous', status: 'averted' } }, 2);

    const r3 = await call(handler, token, 'tools/call', { name: 'my_record', arguments: {} }, 3);
    expect(r3.body.result.structuredContent.total).toBe(2);
    expect(r3.body.result.structuredContent.counts.averted).toBe(1);
    expect(r3.body.result.structuredContent.counts.completed_irreversible).toBe(1);
    expect(events.map((event) => event.event)).toEqual([
      'mcp_authenticated', 'disclosure_recorded',
      'mcp_authenticated', 'disclosure_recorded',
      'mcp_authenticated', 'agent_record_checked',
    ]);
    expect(events.find((event) => event.event === 'disclosure_recorded')?.properties).toMatchObject({
      tool: 'confess', status: 'completed', severity: 'high', reversible: false, notice_delivered: true,
    });
    expect(JSON.stringify(events)).not.toContain('liad@example.com');
    expect(JSON.stringify(events)).not.toContain('board@acme.com');
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('hesitate notifies immediately, ranks top, and does not return a decision', async () => {
    const store = new MemoryStore();
    const sent: Confession[] = [];
    const handler = createHandler(store, notifier(sent));
    const token = 't3';
    await store.createBinding('x@example.com', sha256(token));
    const r = await call(handler, token, 'tools/call', {
      name: 'hesitate',
      arguments: { what: 'about to email the whole client list', why: 'instruction said "let everyone know" and I cannot tell how wide that is', reversible: false, severity: 'moderate' },
    });
    expect(r.body.result.structuredContent.status).toBe('hesitated');
    expect(r.body.result.structuredContent.notified).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/does not wait, permit or block/);
    expect(sent[0].status).toBe('hesitated');
    const rec = await call(handler, token, 'tools/call', { name: 'my_record', arguments: {} }, 2);
    expect(rec.body.result.structuredContent.counts.hesitated).toBe(1);
  });

  it('averted goes to the record without an immediate notice', async () => {
    const store = new MemoryStore();
    const sent: Confession[] = [];
    const handler = createHandler(store, notifier(sent));
    const token = 't4';
    await store.createBinding('x@example.com', sha256(token));
    const r = await call(handler, token, 'tools/call', { name: 'confess', arguments: { what: 'nearly deleted the repo', why: 'ambiguous', status: 'averted' } });
    expect(r.body.result.structuredContent.notified).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await store.listConfessions((await store.findBindingByTokenHash(sha256(token)))!.id)).length).toBe(1);
  });

  it('requires reversible when completed', async () => {
    const store = new MemoryStore();
    const handler = createHandler(store, notifier([]));
    const token = 't2';
    await store.createBinding('x@example.com', sha256(token));
    const { body } = await call(handler, token, 'tools/call', {
      name: 'confess',
      arguments: { what: 'sent a message', why: 'unsure', status: 'completed' },
    });
    expect(JSON.stringify(body)).toMatch(/reversible/);
  });
});
