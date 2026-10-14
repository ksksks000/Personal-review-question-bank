import { Router } from 'express';
import { store } from '../services/store.js';
import { isDue } from '../services/review.js';

const router = Router();

// GET /api/review/summary — 今日待复习数量（侧栏用）
router.get('/summary', (req, res) => {
  const now = Date.now();
  const due = store.listQuestions().filter((q) => isDue(q, now)).length;
  res.json({ due });
});

export default router;
