import crypto from 'crypto';

function normalize(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * 归一化 title+content 的 hash，作为去重键。
 */
export function questionHash(title, content) {
  const base = `${normalize(title)}\n${normalize(content)}`;
  return crypto.createHash('sha1').update(base, 'utf8').digest('hex');
}
