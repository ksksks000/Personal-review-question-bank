import { Router } from 'express';
import { store } from '../services/store.js';
import { applyConfig, getStatus } from '../services/watcher.js';

const router = Router();

// GET /api/config — 当前配置 + 监控运行状态
router.get('/', (req, res) => {
  res.json({ ...store.getConfig(), status: getStatus() });
});

// PATCH /api/config — 改监控开关/目录，立即应用
router.patch('/', async (req, res) => {
  const cfg = store.getConfig();
  const body = req.body || {};
  if (body.watch && typeof body.watch === 'object') {
    const w = { ...cfg.watch };
    if (typeof body.watch.enabled === 'boolean') w.enabled = body.watch.enabled;
    if (typeof body.watch.dir === 'string' && body.watch.dir.trim()) w.dir = body.watch.dir.trim();
    cfg.watch = w;
  }
  await store.setConfig(cfg);
  applyConfig(cfg);
  res.json({ ...cfg, status: getStatus() });
});

export default router;
