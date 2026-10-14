import { Router } from 'express';
import { store } from '../services/store.js';

const router = Router();

const UNCATEGORIZED = 'uncategorized';
const MASTERY_VALUES = ['unseen', 'learning', 'mastered'];

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// GET /api/backup/export — 下载完整备份 JSON
router.get('/export', (req, res) => {
  const data = {
    app: 'tiku',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    schemaVersion: store.meta?.schemaVersion ?? 1,
    categories: store.listCategories(),
    questions: store.listQuestions(),
    importLog: store.listImportLog(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="tiku-backup-${stamp()}.json"`);
  res.type('application/json');
  res.send(JSON.stringify(data, null, 2));
});

// POST /api/backup/restore — 用备份文件整体替换当前题库（破坏性，前端需二次确认）
router.post('/restore', async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.categories) || !Array.isArray(body.questions)) {
    return res.status(400).json({ error: '备份文件结构不合法' });
  }

  const categories = body.categories.filter((c) => c && typeof c.id === 'string');
  if (!categories.some((c) => c.id === UNCATEGORIZED)) {
    categories.push({ id: UNCATEGORIZED, name: '未分类', aliases: [], order: 999, system: true });
  }
  const catIds = new Set(categories.map((c) => c.id));

  const questions = body.questions
    .filter((q) => q && typeof q.id === 'string')
    .map((q) => ({
      ...q,
      categoryId: catIds.has(q.categoryId) ? q.categoryId : UNCATEGORIZED,
      tags: Array.isArray(q.tags) ? q.tags : [],
      mastery: MASTERY_VALUES.includes(q.mastery) ? q.mastery : 'unseen',
    }));
  const importLog = Array.isArray(body.importLog) ? body.importLog.slice(0, 200) : [];

  await store.replaceAll({ categories, questions, importLog });
  res.json({ ok: true, questions: questions.length, categories: categories.length });
});

export default router;