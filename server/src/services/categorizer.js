/**
 * 分类建议：按优先级短路
 * 1. front-matter category 精确匹配分类名/别名
 * 2. 来源路径/文件名任一段命中分类名/别名
 * 3. front-matter tags 与分类 aliases 交集
 * 4. 正文前 300 字关键词匹配（弱信号）
 * 5. 兜底 uncategorized
 */
const UNCATEGORIZED = 'uncategorized';

function normalizeStr(s) {
  return String(s || '').trim().toLowerCase();
}

function matchAgainstCatalog(value, categories) {
  const v = normalizeStr(value);
  if (!v) return null;
  for (const cat of categories) {
    if (normalizeStr(cat.name) === v) return cat.id;
    for (const alias of cat.aliases || []) {
      if (normalizeStr(alias) === v) return cat.id;
    }
  }
  // 宽松：包含关系（如路径段 "CSS入门" 命中别名 "css"）
  for (const cat of categories) {
    for (const alias of [cat.name, ...(cat.aliases || [])]) {
      const a = normalizeStr(alias);
      if (a && a.length >= 2 && v.includes(a)) return cat.id;
    }
  }
  return null;
}

function pathSegments(sourcePath, sourceFile) {
  const p = String(sourcePath || '').replace(/\\/g, '/');
  const f = String(sourceFile || '');
  const segs = [];
  if (p) segs.push(...p.split('/'));
  if (f) {
    segs.push(f);
    segs.push(f.replace(/\.md$/i, ''));
    segs.push(...f.replace(/\.md$/i, '').split(/[-_—\s]+/));
  }
  return segs.filter(Boolean);
}

export function suggestCategory({ fmCategory, tags = [], sourcePath = '', sourceFile = '', content = '' }, categories) {
  // 1. front-matter category
  if (fmCategory) {
    const hit = matchAgainstCatalog(fmCategory, categories);
    if (hit) return { categoryId: hit, suggestedBy: 'front-matter' };
  }

  // 2. 路径/文件名
  for (const seg of pathSegments(sourcePath, sourceFile)) {
    const hit = matchAgainstCatalog(seg, categories);
    if (hit) return { categoryId: hit, suggestedBy: 'path' };
  }

  // 3. tags 交集
  for (const tag of tags) {
    const hit = matchAgainstCatalog(tag, categories);
    if (hit) return { categoryId: hit, suggestedBy: 'tags' };
  }

  // 4. 正文头部关键词（弱信号，仅前 300 字）
  const head = String(content || '').slice(0, 300);
  if (head) {
    const lower = head.toLowerCase();
    for (const cat of categories) {
      for (const alias of [cat.name, ...(cat.aliases || [])]) {
        const a = normalizeStr(alias);
        if (a && a.length >= 3 && lower.includes(a)) {
          return { categoryId: cat.id, suggestedBy: 'keywords' };
        }
      }
    }
  }

  return { categoryId: UNCATEGORIZED, suggestedBy: 'fallback' };
}
