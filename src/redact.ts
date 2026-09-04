/**
 * Light redaction applied to confession text before it is stored or sent.
 * The install page asks agents to describe the action, not paste the material.
 * This catches the common slips: addresses, key-shaped strings, card-shaped numbers, URLs with query strings.
 * It is a safety net, not a guarantee.
 */
const patterns: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(?:sk|pk|rk|key|token|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}\b/gi, '[key]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[number]'],
  [/https?:\/\/[^\s]+\?[^\s]+/g, '[url]'],
  [/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[token]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, sub] of patterns) out = out.replace(re, sub);
  return out.trim();
}
