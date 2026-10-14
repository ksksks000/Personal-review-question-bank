import { Router } from 'express';
import { store } from '../services/store.js';
import { newId } from '../lib/ids.js';
import { questionHash } from '../services/dedupe.js';
import { scheduleReview } from '../services/review.js';

const router = Router();

const SUMMARY_FIELDS = ['id', 'title', 'categoryId', 'tags', 'sourceFile', 'excerpt', 'mastery', 'createdAt', 'updatedAt'];

function toSummary(q) {
  const out = {};
  for (const f of SUMMARY_FIELDS) out[f] = q[f];
  return out;
}

function excerptOf(text) {
  return String(text || '')
    .replace(/[#*>`\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// GET /api/questions 列表（摘要 + 筛选 + 分页）
router.get('/', (req, res) => {
  const { q, categoryId, tag, mastery, sort } = req.query;
  const fullText = String(req.query.scope) === 'full';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

  let items = store.listQuestions();

  if (q) {
    const keyword = String(q).toLowerCase();
    items = items.filter((item) => {
      if (item.title.toLowerCase().includes(keyword)) return true;
      if (item.excerpt && item.excerpt.toLowerCase().includes(keyword)) return true;
      if ((item.tags || []).some((t) => t.toLowerCase().includes(keyword))) return true;
      // scope=full 时再搜题干与参考答案正文
      if (fullText) {
        if ((item.content || '').toLowerCase().includes(keyword)) return true;
        if ((item.answer || '').toLowerCase().includes(keyword)) return true;
      }
      return false;
    });
  }
  if (categoryId) items = items.filter((item) => item.categoryId === categoryId);
  if (tag) items = items.filter((item) => (item.tags || []).includes(String(tag)));
  if (mastery) items = items.filter((item) => item.mastery === mastery);
  // due=1：只出到复习时间的题（今日复习）
  if (String(req.query.due) === '1') {
    const now = Date.now();
    items = items.filter((item) => item.review?.dueAt && Date.parse(item.review.dueAt) <= now);
  }

  items = [...items];
  if (sort === 'createdAtDesc') items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  else if (sort === 'titleAsc') items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  else items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const total = items.length;
  const start = (page - 1) * pageSize;
  res.json({
    items: items.slice(start, start + pageSize).map(toSummary),
    total,
    page,
    pageSize,
  });
});

// GET /api/questions/:id 单题全量
router.get('/:id', (req, res) => {
  const q = store.getQuestion(req.params.id);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  res.json(q);
});

// POST /api/questions 手动新建
router.post('/', async (req, res) => {
  const { title, content = '', answer = '', categoryId = 'uncategorized', tags = [], mastery = 'unseen' } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '标题不能为空' });

  const now = new Date().toISOString();
  const q = {
    id: newId('q'),
    title: String(title).trim(),
    content: String(content),
    answer: String(answer),
    categoryId: store.getCategory(categoryId) ? categoryId : 'uncategorized',
    tags: Array.isArray(tags) ? tags.map(String).map((t) => t.trim()).filter(Boolean) : [],
    sourceFile: '',
    sourcePath: '',
    excerpt: excerptOf(content || answer),
    mastery: ['unseen', 'learning', 'mastered'].includes(mastery) ? mastery : 'unseen',
    hash: questionHash(title, content),
    createdAt: now,
    updatedAt: now,
  };
  await store.addQuestions([q]);
  res.status(201).json(q);
});

// PATCH /api/questions/:id 局部更新
router.patch('/:id', async (req, res) => {
  const existing = store.getQuestion(req.params.id);
  if (!existing) return res.status(404).json({ error: '题目不存在' });

  const patch = {};
  const body = req.body || {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.content === 'string') patch.content = body.content;
  if (typeof body.answer === 'string') patch.answer = body.answer;
  if (typeof body.categoryId === 'string') {
    patch.categoryId = store.getCategory(body.categoryId) ? body.categoryId : 'uncategorized';
  }
  if (Array.isArray(body.tags)) patch.tags = body.tags.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof body.mastery === 'string' && ['unseen', 'learning', 'mastered'].includes(body.mastery)) {
    patch.mastery = body.mastery;
  }
  if (patch.mastery) {
    // 掌握状态即复习反馈 → 重排 SM-2 间隔
    patch.review = scheduleReview(existing.review, patch.mastery) || undefined;
  }
  if (patch.title !== undefined || patch.content !== undefined) {
    patch.hash = questionHash(patch.title ?? existing.title, patch.content ?? existing.content);
    patch.excerpt = excerptOf(patch.content ?? existing.content);
  }

  const updated = await store.updateQuestion(req.params.id, patch);
  res.json(updated);
});

// DELETE /api/questions/:id
router.delete('/:id', async (req, res) => {
  const q = store.getQuestion(req.params.id);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  await store.deleteQuestions([req.params.id]);
  res.json({ ok: true });
});

// POST /api/questions/batch-delete 批量删除
router.post('/batch-delete', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  await store.deleteQuestions(ids);
  res.json({ ok: true, deleted: ids.length });
});

// POST /api/questions/batch-update 批量改分类/掌握状态
router.post('/batch-update', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
  const patch = {};
  if (typeof req.body?.categoryId === 'string') {
    patch.categoryId = store.getCategory(req.body.categoryId) ? req.body.categoryId : 'uncategorized';
  }
  if (typeof req.body?.mastery === 'string' && ['unseen', 'learning', 'mastered'].includes(req.body.mastery)) {
    patch.mastery = req.body.mastery;
  }
  if (!ids.length || Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'ids 或更新字段不能为空' });
  }
  let updated = 0;
  for (const id of ids) {
    const q = store.getQuestion(id);
    if (!q) continue;
    const perPatch = { ...patch };
    if (patch.mastery) perPatch.review = scheduleReview(q.review, patch.mastery) || undefined;
    await store.updateQuestion(id, perPatch);
    updated++;
  }
  res.json({ ok: true, updated });
});

export default router;
