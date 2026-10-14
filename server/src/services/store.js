import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from '../lib/fsAtomic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../data');

const META_FILE = path.join(DATA_DIR, 'meta.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const IMPORT_LOG_FILE = path.join(DATA_DIR, 'import-log.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DATA_FILES = [META_FILE, CATEGORIES_FILE, QUESTIONS_FILE, IMPORT_LOG_FILE, CONFIG_FILE];
const BACKUP_KEEP = 10;
const BACKUP_NAME_RE = /^\d{8}_\d{6}$/;

const SCHEMA_VERSION = 1;
// 默认监控目录用相对路径（相对项目根解析），避免把本机绝对路径写进 config.json
const DEFAULT_CONFIG = { watch: { enabled: true, dir: 'import' } };

const SEED_CATEGORIES = [
  { id: 'frontend', name: '前端', aliases: ['前端', 'frontend', 'css', 'js', 'javascript', 'react', 'vue', '浏览器', 'http', 'html'], order: 1, system: false },
  { id: 'backend', name: '后端', aliases: ['后端', 'backend', 'java', 'spring', 'go', 'golang', 'node', '数据库', 'mysql', 'redis', '微服务', '并发'], order: 2, system: false },
  { id: 'algorithm', name: '算法', aliases: ['算法', 'algorithm', '数据结构', 'leetcode', '动态规划', 'dp', '排序', '链表', '树'], order: 3, system: false },
  { id: 'ai', name: 'AI', aliases: ['ai', '人工智能', '机器学习', 'machine learning', '深度学习', 'deep learning', 'llm', '大模型', 'nlp', 'pytorch', 'transformer'], order: 4, system: false },
  { id: 'agent', name: 'Agent', aliases: ['agent', '智能体', 'rag', 'mcp', 'function calling', 'prompt', '提示词', '多智能体'], order: 5, system: false },
  { id: 'uncategorized', name: '未分类', aliases: [], order: 999, system: true },
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * 持久化唯一入口：启动时全量加载进内存，变更后原子写回。
 */
class Store {
  constructor() {
    this.meta = null;
    this.categories = [];
    this.questions = [];
    this.importLog = [];
    this.config = null;
    this._writeQueue = Promise.resolve();
  }

  init() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(META_FILE)) {
      this.meta = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() };
      fs.writeFileSync(META_FILE, JSON.stringify(this.meta, null, 2), 'utf8');
    } else {
      this.meta = readJson(META_FILE, { schemaVersion: SCHEMA_VERSION });
    }

    if (!fs.existsSync(CATEGORIES_FILE)) {
      this.categories = SEED_CATEGORIES.map((c) => ({ ...c, aliases: [...c.aliases] }));
      this._writeSync(CATEGORIES_FILE, this.categories);
    } else {
      this.categories = readJson(CATEGORIES_FILE, []);
      // 内置未分类永远存在
      if (!this.categories.some((c) => c.id === 'uncategorized')) {
        const seed = SEED_CATEGORIES.find((c) => c.id === 'uncategorized');
        this.categories.push({ ...seed, aliases: [] });
        this._writeSync(CATEGORIES_FILE, this.categories);
      }
    }

    this.questions = fs.existsSync(QUESTIONS_FILE) ? readJson(QUESTIONS_FILE, []) : [];
    if (!fs.existsSync(QUESTIONS_FILE)) this._writeSync(QUESTIONS_FILE, this.questions);

    this.importLog = fs.existsSync(IMPORT_LOG_FILE) ? readJson(IMPORT_LOG_FILE, []) : [];
    if (!fs.existsSync(IMPORT_LOG_FILE)) this._writeSync(IMPORT_LOG_FILE, this.importLog);

    if (!fs.existsSync(CONFIG_FILE)) {
      this.config = { watch: { ...DEFAULT_CONFIG.watch } };
      this._writeSync(CONFIG_FILE, this.config);
    } else {
      const loaded = readJson(CONFIG_FILE, {});
      this.config = { ...loaded, watch: { ...DEFAULT_CONFIG.watch, ...(loaded.watch || {}) } };
    }

    this._backup();
  }

  /**
   * 启动时自动快照 data/ 到 data/backups/<时间戳>/。
   * 与最近一份备份逐字节一致则跳过（避免每次启动都堆一份无用备份）。保留最近 BACKUP_KEEP 份。
   */
  _backup() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const prev = fs.readdirSync(BACKUP_DIR).filter((n) => BACKUP_NAME_RE.test(n)).sort();
      if (prev.length) {
        const latest = path.join(BACKUP_DIR, prev[prev.length - 1]);
        if (this._backupMatches(latest)) return;
      }
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const dir = path.join(BACKUP_DIR, stamp);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of DATA_FILES) {
        fs.copyFileSync(f, path.join(dir, path.basename(f)));
      }
      // 只保留最近 N 份
      const all = fs.readdirSync(BACKUP_DIR).filter((n) => BACKUP_NAME_RE.test(n)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
        fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[store] 自动备份失败:', err.message);
    }
  }

  _backupMatches(dir) {
    for (const f of DATA_FILES) {
      const b = path.join(dir, path.basename(f));
      if (!fs.existsSync(b)) return false;
      if (!fs.readFileSync(f).equals(fs.readFileSync(b))) return false;
    }
    return true;
  }

  _writeSync(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  // 串行化写入，避免并发写文件互相覆盖
  _persist(file, data) {
    const snapshot = JSON.stringify(data, null, 2);
    this._writeQueue = this._writeQueue.then(() => writeFileAtomic(file, snapshot)).catch((err) => {
      console.error(`[store] 写入 ${path.basename(file)} 失败:`, err.message);
    });
    return this._writeQueue;
  }

  // ---- questions ----
  listQuestions() {
    return this.questions;
  }

  getQuestion(id) {
    return this.questions.find((q) => q.id === id) || null;
  }

  addQuestions(items) {
    this.questions.push(...items);
    return this._persist(QUESTIONS_FILE, this.questions);
  }

  updateQuestion(id, patch) {
    const q = this.getQuestion(id);
    if (!q) return null;
    Object.assign(q, patch, { updatedAt: new Date().toISOString() });
    return this._persist(QUESTIONS_FILE, this.questions).then(() => q);
  }

  deleteQuestions(ids) {
    const idSet = new Set(ids);
    this.questions = this.questions.filter((q) => !idSet.has(q.id));
    return this._persist(QUESTIONS_FILE, this.questions);
  }

  getQuestionHashes() {
    return new Set(this.questions.map((q) => q.hash).filter(Boolean));
  }

  // ---- categories ----
  listCategories() {
    return this.categories;
  }

  getCategory(id) {
    return this.categories.find((c) => c.id === id) || null;
  }

  addCategory(cat) {
    this.categories.push(cat);
    return this._persist(CATEGORIES_FILE, this.categories).then(() => cat);
  }

  updateCategory(id, patch) {
    const c = this.getCategory(id);
    if (!c) return null;
    Object.assign(c, patch);
    return this._persist(CATEGORIES_FILE, this.categories).then(() => c);
  }

  removeCategory(id) {
    const c = this.getCategory(id);
    if (!c || c.system) return null;
    this.categories = this.categories.filter((x) => x.id !== id);
    return this._persist(CATEGORIES_FILE, this.categories).then(() => c);
  }

  // ---- import log ----
  addImportLog(entry) {
    this.importLog.unshift(entry);
    if (this.importLog.length > 200) this.importLog.length = 200;
    return this._persist(IMPORT_LOG_FILE, this.importLog);
  }

  listImportLog() {
    return this.importLog;
  }

  // ---- config ----
  getConfig() {
    return this.config;
  }

  setConfig(cfg) {
    this.config = cfg;
    return this._persist(CONFIG_FILE, this.config);
  }

  // ---- 整体替换（备份恢复用） ----
  async replaceAll({ categories, questions, importLog }) {
    this.categories = categories;
    this.questions = questions;
    this.importLog = importLog;
    this._persist(CATEGORIES_FILE, this.categories);
    this._persist(QUESTIONS_FILE, this.questions);
    await this._persist(IMPORT_LOG_FILE, this.importLog);
  }
}

export const store = new Store();
