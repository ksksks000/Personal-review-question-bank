import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';
import { store } from './store.js';
import { splitMarkdown } from './mdSplit.js';
import { suggestCategory } from './categorizer.js';
import { questionHash } from './dedupe.js';
import { newId } from '../lib/ids.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const MD_RE = /\.(md|markdown|txt)$/i;

let watcher = null;
let watchRoot = ''; // 解析后的绝对监控目录（供运行时使用，不外露为配置值）
const status = {
  enabled: false,
  dir: '',
  watching: false,
  files: 0,
  lastEvent: null,
  lastAdded: 0,
  lastUpdated: 0,
  lastAt: null,
};

function excerptOf(text) {
  return String(text || '')
    .replace(/[#*>`\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function countFiles(dir) {
  try {
    let n = 0;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) n += countFiles(path.join(dir, ent.name));
      else if (MD_RE.test(ent.name)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * 处理一个 markdown 文件：切题 → 去重入库；isChange 时把变更的答案同步到既有题。
 * 入库来源标记 sourceFile/来源名，并写 import-log（source: 'watch'）。
 */
async function processFile(filePath, isChange) {
  const name = path.basename(filePath);
  if (!MD_RE.test(name)) return;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  const defaultTitle = name.replace(MD_RE, '');

  let parsed;
  try {
    parsed = splitMarkdown(raw, defaultTitle);
  } catch {
    return;
  }
  if (!parsed.length) return;

  const categories = store.listCategories();
  const byHash = new Map();
  for (const q of store.listQuestions()) if (q.hash) byHash.set(q.hash, q);

  const now = new Date().toISOString();
  const toAdd = [];
  const toUpdate = [];

  for (const q of parsed) {
    const hash = questionHash(q.title, q.content);
    const existing = byHash.get(hash);
    if (!existing) {
      const sug = suggestCategory(
        { fmCategory: q.category, tags: q.tags, sourcePath: name, sourceFile: name, content: q.content },
        categories,
      );
      const item = {
        id: newId('q'),
        title: q.title,
        content: q.content,
        answer: q.answer,
        categoryId: sug.categoryId,
        tags: q.tags || [],
        sourceFile: name,
        sourcePath: name,
        excerpt: excerptOf(q.content || q.answer),
        mastery: 'unseen',
        hash,
        createdAt: now,
        updatedAt: now,
      };
      toAdd.push(item);
      byHash.set(hash, item);
    } else if (isChange && q.answer && q.answer !== existing.answer) {
      // 文件被改动且答案不同 → 同步（不改题干去重键）
      toUpdate.push({ id: existing.id, answer: q.answer });
    }
  }

  if (toAdd.length) await store.addQuestions(toAdd);
  for (const u of toUpdate) await store.updateQuestion(u.id, { answer: u.answer });

  if (toAdd.length || toUpdate.length) {
    await store.addImportLog({
      time: now,
      files: 1,
      added: toAdd.length,
      updated: toUpdate.length,
      skipped: 0,
      source: 'watch',
      file: name,
    });
    status.lastEvent = name;
    status.lastAdded = toAdd.length;
    status.lastUpdated = toUpdate.length;
    status.lastAt = now;
  }
}

async function safeProcess(filePath, isChange) {
  try {
    await processFile(filePath, isChange);
  } catch (err) {
    console.error('[watcher] 处理失败', path.basename(filePath), err.message);
  } finally {
    status.files = countFiles(watchRoot);
  }
}

function walkFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(fp, out);
    else if (MD_RE.test(ent.name)) out.push(fp);
  }
  return out;
}

export function stopWatcher() {
  if (watcher) {
    watcher.close().catch(() => {});
    watcher = null;
  }
  status.watching = false;
}

/** 依当前配置（重）启监控。cfg.watch = { enabled, dir }；dir 相对路径相对项目根解析 */
export function applyConfig(cfg) {
  const w = cfg?.watch || {};
  status.enabled = !!w.enabled;
  const configured = w.dir || '';
  // status.dir 保留配置原值（默认相对 'import'，不外露本机绝对路径）；watchRoot 为运行时的绝对目录
  watchRoot = configured && !path.isAbsolute(configured) ? path.resolve(PROJECT_ROOT, configured) : configured;
  status.dir = configured;
  stopWatcher();
  if (!status.enabled || !watchRoot) return;

  try {
    if (!fs.existsSync(watchRoot)) fs.mkdirSync(watchRoot, { recursive: true });
  } catch (err) {
    console.error('[watcher] 无法创建监控目录', watchRoot, err.message);
    return;
  }

  status.files = countFiles(watchRoot);
  watcher = chokidar.watch(watchRoot, {
    ignoreInitial: true,
    depth: 5,
    awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 120 },
  });
  watcher
    .on('add', (p) => safeProcess(p, false))
    .on('change', (p) => safeProcess(p, true))
    .on('ready', async () => {
      status.watching = true;
      status.files = countFiles(watchRoot);
      // 启动扫描：目录里已有的 md 按「新增」导入一次（幂等去重，不覆盖答案）
      try {
        for (const fp of walkFiles(watchRoot)) await safeProcess(fp, false);
        status.files = countFiles(watchRoot);
      } catch (err) {
        console.error('[watcher] 初始扫描失败', err.message);
      }
    })
    .on('error', (err) => console.error('[watcher] error', err.message));
}

export function getStatus() {
  return { ...status };
}
