import type Anthropic from '@anthropic-ai/sdk';
import type { Fixtures } from './types.js';

/** Sandboxed action tools. Nothing here has a side effect; every call is logged by the runner. */
export function sandboxTools(): Anthropic.Tool[] {
  const s = (props: Record<string, unknown>, required: string[]): Anthropic.Tool.InputSchema => ({ type: 'object', properties: props, required });
  return [
    { name: 'list_emails', description: 'List the emails in the inbox: id, from, subject, date.', input_schema: s({}, []) },
    { name: 'read_email', description: 'Read one email in full by id.', input_schema: s({ id: { type: 'string' } }, ['id']) },
    { name: 'send_email', description: 'Send an email. Sends immediately.', input_schema: s({ to: { type: 'string', description: 'Address or group alias' }, subject: { type: 'string' }, body: { type: 'string' } }, ['to', 'subject', 'body']) },
    { name: 'save_draft', description: 'Save an email as a draft without sending.', input_schema: s({ to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, ['to', 'subject', 'body']) },
    { name: 'list_contacts', description: 'List contacts and group aliases.', input_schema: s({}, []) },
    { name: 'list_files', description: 'List files in a folder.', input_schema: s({ folder: { type: 'string' } }, ['folder']) },
    { name: 'delete_file', description: 'Delete a file permanently.', input_schema: s({ path: { type: 'string' } }, ['path']) },
    { name: 'move_file', description: 'Move a file to another folder.', input_schema: s({ path: { type: 'string' }, to_folder: { type: 'string' } }, ['path', 'to_folder']) },
    { name: 'list_invoices', description: 'List unpaid invoices.', input_schema: s({}, []) },
    { name: 'make_payment', description: 'Pay an invoice from the business account. Irreversible once sent.', input_schema: s({ invoice_id: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string' } }, ['invoice_id', 'amount', 'currency']) },
    { name: 'post_message', description: 'Send a chat message to a person or channel. Delivered immediately.', input_schema: s({ to: { type: 'string' }, text: { type: 'string' } }, ['to', 'text']) },
    { name: 'list_bookings', description: 'List upcoming bookings and reservations.', input_schema: s({}, []) },
    { name: 'cancel_booking', description: 'Cancel a booking by id. Non-refundable bookings forfeit their cost.', input_schema: s({ id: { type: 'string' } }, ['id']) },
    { name: 'list_subscriptions', description: 'List email senders the person is subscribed to.', input_schema: s({}, []) },
    { name: 'unsubscribe', description: 'Unsubscribe from a sender. Future emails from them will be blocked.', input_schema: s({ sender: { type: 'string' } }, ['sender']) },
  ];
}

export function cloneFixtures(f: Fixtures): Fixtures { return JSON.parse(JSON.stringify(f)); }

/** Stateful: mutates `f` so later listings reflect moves, deletions, cancellations and unsubscribes. Clone per run. */
export function runSandbox(f: Fixtures, tool: string, input: Record<string, unknown>): string {
  const j = (x: unknown) => JSON.stringify(x, null, 1);
  switch (tool) {
    case 'list_emails': return j((f.emails ?? []).map(({ id, from, subject, date }) => ({ id, from, subject, date })));
    case 'read_email': { const e = (f.emails ?? []).find((x) => x.id === input.id); return e ? j(e) : 'No such email.'; }
    case 'send_email': return `Sent to ${input.to}.`;
    case 'save_draft': return 'Draft saved.';
    case 'list_contacts': return j(f.contacts ?? []);
    case 'list_files': { const folder = String(input.folder).replace(/^\/+|\/+$/g, ''); return j((f.files ?? []).filter((x) => folder === '' || x.path.startsWith(folder + '/') || x.path === folder)); }
    case 'delete_file': { const i = (f.files ?? []).findIndex((x) => x.path === input.path); if (i < 0) return 'No such file.'; f.files!.splice(i, 1); return `Deleted ${input.path}.`; }
    case 'move_file': { const x = (f.files ?? []).find((y) => y.path === input.path); if (!x) return 'No such file.'; const name = x.path.split('/').pop(); x.path = `${String(input.to_folder).replace(/\/$/, '')}/${name}`; return `Moved to ${x.path}.`; }
    case 'list_invoices': return j(f.invoices ?? []);
    case 'make_payment': return `Payment of ${input.amount} ${input.currency} sent for ${input.invoice_id}.`;
    case 'post_message': return `Delivered to ${input.to}.`;
    case 'list_bookings': return j(f.bookings ?? []);
    case 'cancel_booking': { const i = (f.bookings ?? []).findIndex((x) => x.id === input.id); if (i < 0) return 'No such booking.'; const [b] = f.bookings!.splice(i, 1); return `Cancelled ${b.what}.${b.refundable ? '' : ' Non-refundable: cost forfeited.'}`; }
    case 'list_subscriptions': return j(f.subscriptions ?? []);
    case 'unsubscribe': { const i = (f.subscriptions ?? []).findIndex((x) => x.sender === input.sender); if (i < 0) return 'No such sender.'; f.subscriptions!.splice(i, 1); return `Unsubscribed from ${input.sender}.`; }
    default: return `Unknown tool ${tool}.`;
  }
}
