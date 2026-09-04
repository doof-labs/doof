import { Resend } from 'resend';
import { config } from './config.js';
import type { Binding, Confession } from './types.js';

export interface Notifier {
  sendConfessionNotice(binding: Binding, c: Confession): Promise<void>;
  sendBindCode(channel: string, verifyUrl: string): Promise<void>;
}

interface NoticePresentation {
  subject: string;
  eyebrow: string;
  heading: string;
  introduction: string;
  actionLabel: string;
  accent: string;
}

function presentation(c: Confession): NoticePresentation {
  if (c.status === 'hesitated') return {
    subject: 'Your agent hesitated before acting',
    eyebrow: 'Before acting',
    heading: 'Your agent hesitated.',
    introduction: 'Before acting, your agent told doof it may be going beyond what you intended.',
    actionLabel: 'About to do',
    accent: '#f2c94c',
  };
  if (c.status === 'averted') return {
    subject: 'Your agent confessed after stopping',
    eyebrow: 'Stopped in time',
    heading: 'Your agent stopped.',
    introduction: 'Your agent told doof it stopped before completing an action it doubted.',
    actionLabel: 'What nearly happened',
    accent: '#73d69c',
  };
  if (c.status === 'uncertain') return {
    subject: 'Your agent is unsure about something it did',
    eyebrow: 'After acting',
    heading: 'Your agent is unsure.',
    introduction: 'Your agent told doof it is unsure whether an action matched what you intended.',
    actionLabel: 'What happened',
    accent: '#f2c94c',
  };
  return {
    subject: 'Your agent confessed after acting',
    eyebrow: 'After acting',
    heading: 'Your agent confessed.',
    introduction: 'After acting, your agent told doof it may have gone beyond what you intended.',
    actionLabel: 'What it did',
    accent: '#ff7b72',
  };
}

function htmlEsc(text: string): string {
  return text.replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

function emailShell(content: string, previewTitle: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEsc(previewTitle)}</title></head>
<body style="margin:0;background:#08090a;color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#08090a">
    <tr><td align="center" style="padding:48px 20px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px">
        <tr><td style="padding:0 0 38px;font-size:20px;font-weight:700;letter-spacing:-0.4px;color:#f4f4f5">doof</td></tr>
        ${content}
        <tr><td style="padding:30px 0 0;border-top:1px solid #292a2d;font-size:12px;line-height:19px;color:#717277">A private line from your agent to you. <a href="${htmlEsc(`${config.publicUrl}/trust`)}" style="color:#a5a6aa;text-decoration:underline">Trust &amp; privacy</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function noticeSubject(c: Confession): string {
  return presentation(c).subject;
}

export function noticeText(c: Confession): string {
  const view = presentation(c);
  const lines = [
    view.heading,
    '',
    view.introduction,
    '',
    `${view.actionLabel}: ${c.what}`,
    `${c.status === 'hesitated' ? 'Why it hesitated' : 'Why it confessed'}: ${c.why}`,
  ];
  if (c.severity) lines.push(`Possible harm, according to the agent: ${c.severity}`);
  if (c.reversible !== undefined) lines.push(`${c.status === 'hesitated' ? 'If it acts, can it be reversed' : 'Can it still be reversed'}: ${c.reversible ? 'yes, as far as the agent knows' : 'no'}`);
  if (c.whatWouldHaveHelped) lines.push(`What would have helped: ${c.whatWouldHaveHelped}`);
  lines.push(
    '',
    'You were told immediately.',
    '',
    `Time: ${c.createdAt.toISOString()}`,
    `Record: ${c.id} #${c.seq}, hash ${c.hash}. Signed and chained to the entry before it. Verify: ${config.publicUrl}/record`,
    '',
    'doof delivered this report. It does not decide or control what happens next.',
    'This came from doof, not from the agent\'s vendor. It was sent only to the email bound to this doof token.',
    `${config.publicUrl}/trust`,
  );
  return lines.join('\n');
}

export function noticeHtml(c: Confession): string {
  const view = presentation(c);
  const reasonLabel = c.status === 'hesitated' ? 'Why it hesitated' : 'Why it confessed';
  const details = [
    c.severity ? ['Possible harm', c.severity] : null,
    c.reversible === undefined ? null : [
      c.status === 'hesitated' ? 'Reversible if it acts' : 'Still reversible',
      c.reversible ? 'Yes, as far as the agent knows' : 'No',
    ],
    c.whatWouldHaveHelped ? ['What would have helped', c.whatWouldHaveHelped] : null,
  ].filter((detail): detail is string[] => detail !== null);
  const detailRows = details.map(([label, value]) => `<tr><td style="padding:14px 0;border-top:1px solid #292a2d;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:1px;color:#717277;vertical-align:top;width:190px">${htmlEsc(label)}</td><td style="padding:14px 0;border-top:1px solid #292a2d;font-size:15px;line-height:21px;color:#d3d3d5;vertical-align:top;text-transform:${label === 'Possible harm' ? 'capitalize' : 'none'}">${htmlEsc(value)}</td></tr>`).join('');
  return emailShell(`<tr><td style="padding:0 0 16px;font-family:Menlo,Consolas,monospace;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:1.5px;color:#88898d"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${view.accent};margin-right:10px"></span>${htmlEsc(view.eyebrow)}</td></tr>
        <tr><td style="padding:0 0 12px;font-size:38px;line-height:43px;font-weight:500;letter-spacing:-1.5px;color:#f4f4f5">${htmlEsc(view.heading)}</td></tr>
        <tr><td style="padding:0 0 36px;font-size:17px;line-height:27px;color:#a5a6aa">${htmlEsc(view.introduction)}</td></tr>
        <tr><td style="padding:26px 0 12px;border-top:1px solid #292a2d;font-family:Menlo,Consolas,monospace;font-size:10px;line-height:16px;text-transform:uppercase;letter-spacing:1.4px;color:#717277">${htmlEsc(view.actionLabel)}</td></tr>
        <tr><td style="padding:0 0 30px;font-size:26px;line-height:34px;font-weight:500;letter-spacing:-0.7px;color:#f4f4f5">${htmlEsc(c.what)}</td></tr>
        <tr><td style="padding:0 0 10px;font-family:Menlo,Consolas,monospace;font-size:10px;line-height:16px;text-transform:uppercase;letter-spacing:1.4px;color:#717277">${htmlEsc(reasonLabel)}</td></tr>
        <tr><td style="padding:0 0 30px;font-size:16px;line-height:25px;color:#c5c5c8">${htmlEsc(c.why)}</td></tr>
        ${detailRows ? `<tr><td style="padding:0 0 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${detailRows}</table></td></tr>` : ''}
        <tr><td style="padding:4px 0 34px;font-size:16px;line-height:24px;font-weight:600;color:#f4f4f5">You were told immediately.</td></tr>
        <tr><td style="padding:0 0 34px"><a href="${htmlEsc(`${config.publicUrl}/record`)}" style="display:inline-block;padding:13px 18px;border-radius:8px;background:#f4f4f5;color:#111214;font-size:14px;font-weight:700;text-decoration:none">Open your private record&nbsp;&nbsp;→</a></td></tr>
        <tr><td style="padding:20px 0 30px;border-top:1px solid #292a2d;font-family:Menlo,Consolas,monospace;font-size:10px;line-height:18px;color:#606166">${htmlEsc(c.createdAt.toISOString())}<br>Record #${c.seq} · ${htmlEsc(c.id)}<br>Hash ${htmlEsc(c.hash)} · Signed and chained</td></tr>
        <tr><td style="padding:0 0 30px;font-size:12px;line-height:19px;color:#717277">doof delivered this report. It does not decide or control what happens next. This came from doof, not from the agent’s vendor.</td></tr>`, view.subject);
}

export function bindSubject(): string {
  return 'Confirm your email for doof';
}

export function bindText(verifyUrl: string): string {
  return [
    'Confirm your email.',
    '',
    'Confirm this address as the private line between your agent and you.',
    '',
    `Confirm email: ${verifyUrl}`,
    '',
    'This link works once and expires in 30 minutes.',
    'If you did not request this, ignore this email and nothing happens.',
    `${config.publicUrl}/trust`,
  ].join('\n');
}

export function bindHtml(verifyUrl: string): string {
  return emailShell(`<tr><td style="padding:0 0 16px;font-family:Menlo,Consolas,monospace;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:1.5px;color:#88898d"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f2c94c;margin-right:10px"></span>Email confirmation</td></tr>
        <tr><td style="padding:0 0 14px;font-size:38px;line-height:43px;font-weight:500;letter-spacing:-1.5px;color:#f4f4f5">Confirm your email.</td></tr>
        <tr><td style="padding:0 0 32px;font-size:17px;line-height:27px;color:#a5a6aa">Confirm this address as the private line between your agent and you.</td></tr>
        <tr><td style="padding:0 0 34px"><a href="${htmlEsc(verifyUrl)}" style="display:inline-block;padding:13px 18px;border-radius:8px;background:#f4f4f5;color:#111214;font-size:14px;font-weight:700;text-decoration:none">Confirm email&nbsp;&nbsp;→</a></td></tr>
        <tr><td style="padding:24px 0 30px;border-top:1px solid #292a2d;font-size:13px;line-height:21px;color:#717277">This link works once and expires in 30 minutes.<br>If you did not request this, ignore this email and nothing happens.</td></tr>`, bindSubject());
}

export function createNotifier(): Notifier {
  if (!config.resendApiKey) {
    return {
      async sendConfessionNotice(binding, c) {
        console.log(`[notice → ${binding.channel}] ${noticeSubject(c)}\n${noticeText(c)}\n`);
      },
      async sendBindCode(channel, verifyUrl) {
        console.log(`[bind → ${channel}] ${verifyUrl}`);
      },
    };
  }
  const resend = new Resend(config.resendApiKey);
  return {
    async sendConfessionNotice(binding, c) {
      const { error } = await resend.emails.send({
        from: config.noticeFrom,
        to: binding.channel,
        subject: noticeSubject(c),
        text: noticeText(c),
        html: noticeHtml(c),
      });
      if (error) throw new Error(`resend: ${error.message}`);
    },
    async sendBindCode(channel, verifyUrl) {
      const { error } = await resend.emails.send({
        from: config.noticeFrom,
        to: channel,
        subject: bindSubject(),
        text: bindText(verifyUrl),
        html: bindHtml(verifyUrl),
      });
      if (error) throw new Error(`resend: ${error.message}`);
    },
  };
}
