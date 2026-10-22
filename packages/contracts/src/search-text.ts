import { pinyin } from 'pinyin-pro';

const keys = new Map<string, string[]>();
export function searchKeys(text: string): string[] {
  const normalized = text.toLocaleLowerCase();
  const cached = keys.get(normalized);
  if (cached) return cached;
  const parts = /\p{Script=Han}/u.test(normalized) ? pinyin(normalized, { toneType: 'none', type: 'array', nonZh: 'consecutive' }) : [];
  const result = [normalized, parts.join(''), parts.map((part) => /^\p{Script=Han}$/u.test(part) ? part : part[0] ?? '').join('')];
  // Keep literal non-Chinese runs in initials (e.g. IMG2026 + 人像).
  if (parts.length) result.push(pinyin(normalized, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join(''));
  if (keys.size >= 60000) keys.delete(keys.keys().next().value!);
  keys.set(normalized, result);
  return result;
}
export function matchesSearch(text: string, query: string): boolean {
  const input = query.trim().toLocaleLowerCase();
  return !input || searchKeys(text).some((key) => key.includes(input));
}
