import { Router } from 'express';
import { store } from '../services/store.js';
import { newId } from '../lib/ids.js';

const router = Router();

// GET /api/categories 含各分类题数与错题（learning）数
router.get('/', (req, res) => {
  const counts = {};
  const learningCounts = {};
  for (const q of store.listQuestions()) {
    counts[q.categoryId] = (counts[q.categoryId] || 0) + 1;
    if (q.mastery === 'learning') learningCounts[q.categoryId] = (learningCounts[q.categoryId] || 0) + 1;
  }
  const items = store
    .listCategories()
    .map((c) => ({ ...c, count: counts[c.id] || 0, learningCount: learningCounts[c.id] || 0 }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(items);
});

// POST /api/categories 新建
router.post('/', async (req, res) => {
  const { name, aliases = [] } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '分类名不能为空' });
  const trimmed = String(name).trim();
  if (store.listCategories().some((c) => c.name === trimmed)) {
    return res.status(409).json({ error: '分类已存在' });
  }
  const cat = {
    id: newId('c'),
    name: trimmed,
    aliases: Array.isArray(aliases) ? aliases.map(String).map((a) => a.trim()).filter(Boolean) : [],
    order: store.listCategories().length,
    system: false,
  };
  await store.addCategory(cat);
  res.status(201).json(cat);
});

// PATCH /api/categories/:id 改名/改别名/改排序
router.patch('/:id', async (req, res) => {
  const cat = store.getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: '分类不存在' });
  const body = req.body || {};
  const patch = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body.aliases)) patch.aliases = body.aliases.map(String).map((a) => a.trim()).filter(Boolean);
  if (body.order !== undefined) patch.order = Number(body.order) || 0;
  const updated = await store.updateCategory(cat.id, patch);
  res.json(updated);
});

// DELETE /api/categories/:id（题目归入未分类；system 拒绝）
router.delete('/:id', async (req, res) => {
  const cat = store.getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: '分类不存在' });
  if (cat.system) return res.status(400).json({ error: '内置分类不可删除' });

  // 其题目归入未分类
  const moved = store.listQuestions().filter((q) => q.categoryId === cat.id);
  for (const q of moved) {
    await store.updateQuestion(q.id, { categoryId: 'uncategorized' });
  }
  await store.removeCategory(cat.id);
  res.json({ ok: true, moved: moved.length });
});

export default router;
