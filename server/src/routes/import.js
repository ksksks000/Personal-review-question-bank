import { Router } from 'express';
import multer from 'multer';
import { store } from '../services/store.js';
import { splitMarkdown } from '../services/mdSplit.js';
import { suggestCategory } from '../services/categorizer.js';
import { questionHash } from '../services/dedupe.js';
import { newId } from '../lib/ids.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 100 },
});

// 解析预览缓存：previewToken -> { items, createdAt }
const previews = new Map();
const PREVIEW_TTL = 10 * 60 * 1000;

function cleanupPreviews() {
  const now = Date.now();
  for (const [token, entry] of previews) {
    if (now - entry.createdAt > PREVIEW_TTL) previews.delete(token);
  }
}

/**
 * multipart 中文文件名可能被 latin1 解码；客户端会额外传 nameHint=encodeURIComponent(name)。
 */
function decodeOriginalName(name) {
  if (!name) return '';
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    // 如果修正后出现常见中文字符或修正导致有效 UTF-8 变化，用修正版
    if (/[一-鿿]/.test(fixed) && !/[一-鿿]/.test(name)) return fixed;
  } catch { /* ignore */ }
  return name;
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ');
}

// POST /api/import/parse — multipart 多文件 → 预览
router.post('/parse', upload.array('files', 100), (req, res) => {
  cleanupPreviews();

  const nameHints = req.body?.nameHints ? String(req.body.nameHints).split('|||') : [];
  const relPaths = req.body?.relPaths ? String(req.body.relPaths).split('|||') : [];
  const categories = store.listCategories();
  // hash → 既有题，用于去重 + 判断「重复但答案有更新」
  const byHash = new Map();
  for (const q of store.listQuestions()) if (q.hash) byHash.set(q.hash, q);
  const existingHashes = new Set(byHash.keys());

  const items = [];
  const files = req.files || [];

  files.forEach((file, index) => {
    let name = nameHints[index] ? decodeURIComponent(nameHints[index]) : decodeOriginalName(file.originalname);
    let relPath = relPaths[index] ? decodeURIComponent(relPaths[index]) : name;
    try {
      // 兼容被 latin1 编码的路径
      const fixedPath = Buffer.from(relPath, 'latin1').toString('utf8');
      if (/[一-鿿]/.test(fixedPath) && !/[一-鿿]/.test(relPath)) relPath = fixedPath;
    } catch { /* ignore */ }

    const defaultTitle = name.replace(/\.md$/i, '');
    let parsed = [];
    try {
      parsed = splitMarkdown(file.buffer.toString('utf8'), defaultTitle);
    } catch (err) {
      items.push({
        localId: newId('l'),
        title: `（解析失败）${name}`,
        content: '',
        answer: '',
        tags: [],
        category: '',
        suggestedCategoryId: 'uncategorized',
        suggestedBy: 'error',
        sourceFile: name,
        sourcePath: relPath,
        isDuplicate: false,
        isUpdated: false,
        include: false,
        error: err.message,
      });
      return;
    }

    for (const q of parsed) {
      const hash = questionHash(q.title, q.content);
      const suggestion = suggestCategory(
        { fmCategory: q.category, tags: q.tags, sourcePath: relPath, sourceFile: name, content: q.content },
        categories,
      );
      const existing = byHash.get(hash);
      const isDuplicate = !!existing;
      // 题干+内容一致、但答案不同的旧题 → 标记「可更新答案」；空答案不算更新，避免覆盖
      const isUpdated =
        isDuplicate &&
        normalizeText(q.answer) !== '' &&
        normalizeText(existing.answer) !== normalizeText(q.answer);
      items.push({
        localId: newId('l'),
        title: q.title,
        content: q.content,
        answer: q.answer,
        tags: q.tags,
        category: q.category,
        suggestedCategoryId: suggestion.categoryId,
        suggestedBy: suggestion.suggestedBy,
        sourceFile: name,
        sourcePath: relPath,
        isDuplicate,
        isUpdated,
        include: !existingHashes.has(hash),
        hash,
      });
    }
  });

  const token = newId('pv');
  previews.set(token, { items, createdAt: Date.now() });

  res.json({
    previewToken: token,
    items: items.map(({ content, answer, hash, ...rest }) => rest), // 预览不回传全文，节省流量
    stats: {
      total: items.length,
      new: items.filter((i) => !i.isDuplicate).length,
      dup: items.filter((i) => i.isDuplicate).length,
      updated: items.filter((i) => i.isDuplicate && i.isUpdated).length,
    },
  });
});

// POST /api/import/commit — { previewToken, items: [{localId, include, categoryId}] } → 入库
router.post('/commit', async (req, res) => {
  cleanupPreviews();
  const { previewToken, items: decisions } = req.body || {};
  const preview = previews.get(previewToken);
  if (!preview) return res.status(410).json({ error: '预览已过期，请重新上传解析' });
  if (!Array.isArray(decisions)) return res.status(400).json({ error: '缺少 items' });

  const decisionMap = new Map(decisions.map((d) => [d.localId, d]));
  const byHash = new Map();
  for (const q of store.listQuestions()) if (q.hash) byHash.set(q.hash, q);
  const existingHashes = new Set(byHash.keys());
  const now = new Date().toISOString();

  const toAdd = [];
  const toUpdate = [];
  let skipped = 0;

  for (const item of preview.items) {
    const decision = decisionMap.get(item.localId);
    if (!decision || item.error) {
      skipped++;
      continue;
    }
    // 勾选「更新答案」且 hash 命中既有题 → 更新答案而非新增（避免产生重复）
    if (decision.updateAnswer && byHash.has(item.hash)) {
      const existing = byHash.get(item.hash);
      if (existing && existing.answer !== item.answer) {
        toUpdate.push({ id: existing.id, answer: item.answer });
        continue;
      }
      skipped++;
      continue;
    }
    if (decision.include === false) {
      skipped++;
      continue;
    }
    // 服务端兜底去重
    if (existingHashes.has(item.hash)) {
      skipped++;
      continue;
    }
    existingHashes.add(item.hash);
    const categoryId =
      decision.categoryId && store.getCategory(decision.categoryId)
        ? decision.categoryId
        : item.suggestedCategoryId;
    toAdd.push({
      id: newId('q'),
      title: item.title,
      content: item.content,
      answer: item.answer,
      categoryId,
      tags: item.tags || [],
      sourceFile: item.sourceFile,
      sourcePath: item.sourcePath,
      excerpt: String(item.content || item.answer || '')
        .replace(/[#*>`\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120),
      mastery: 'unseen',
      hash: item.hash,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toAdd.length) await store.addQuestions(toAdd);
  for (const u of toUpdate) await store.updateQuestion(u.id, { answer: u.answer });

  const fileCount = new Set(preview.items.map((i) => i.sourceFile)).size;
  await store.addImportLog({
    time: now,
    files: fileCount,
    added: toAdd.length,
    updated: toUpdate.length,
    skipped,
  });

  previews.delete(previewToken);
  res.json({ added: toAdd.length, updated: toUpdate.length, skipped });
});

export default router;
