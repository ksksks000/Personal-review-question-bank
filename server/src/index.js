import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { store } from './services/store.js';
import { applyConfig } from './services/watcher.js';
import questionsRouter from './routes/questions.js';
import categoriesRouter from './routes/categories.js';
import importRouter from './routes/import.js';
import statsRouter from './routes/stats.js';
import backupRouter from './routes/backup.js';
import reviewRouter from './routes/review.js';
import configRouter from './routes/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

store.init();
applyConfig(store.getConfig());

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/questions', questionsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/import', importRouter);
app.use('/api/stats', statsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/review', reviewRouter);
app.use('/api/config', configRouter);

// 生产模式：托管前端构建产物
if (isProduction) {
  const dist = path.resolve(__dirname, '../../web/dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 绑定 127.0.0.1：避免 Windows 防火墙弹窗
app.listen(PORT, '127.0.0.1', () => {
  console.log(`题库服务已启动: http://127.0.0.1:${PORT}${isProduction ? ' （生产模式）' : ''}`);
});
