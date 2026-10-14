import { Router } from 'express';
import { store } from '../services/store.js';
import { isDue } from '../services/review.js';

const router = Router();

// GET /api/stats
router.get('/', (req, res) => {
  const questions = store.listQuestions();
  const now = Date.now();
  const byMastery = { unseen: 0, learning: 0, mastered: 0 };
  let dueCount = 0;
  const counts = {};
  for (const q of questions) {
    if (byMastery[q.mastery] !== undefined) byMastery[q.mastery]++;
    if (isDue(q, now)) dueCount++;
    counts[q.categoryId] = (counts[q.categoryId] || 0) + 1;
  }
  const byCategory = store
    .listCategories()
    .map((c) => ({ id: c.id, name: c.name, count: counts[c.id] || 0, system: c.system }))
    .filter((c) => c.count > 0 || !c.system)
    .sort((a, b) => b.count - a.count);

  res.json({
    total: questions.length,
    byCategory,
    byMastery,
    dueCount,
    recentImports: store.listImportLog().slice(0, 10),
  });
});

export default router;
