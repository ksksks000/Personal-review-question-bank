import { useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api/client.js';

const SEP = '|||';

/** 从拖入的条目中解析相对路径（拖文件夹时保留目录结构） */
function getEntryPath(entry, prefix = '') {
  if (!entry) return prefix;
  if (entry.isFile) return prefix + entry.name;
  if (entry.isDirectory) return prefix + entry.name + '/';
  return prefix;
}

function readAllEntries(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const entries = items.map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length === 0) return Promise.resolve(null); // 退化：无相对路径信息
  return Promise.all(entries.map((entry) => traverse(entry, '')));
}

async function traverse(entry, basePath) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, relPath: basePath + entry.name }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    const results = await Promise.all(children.map((child) => traverse(child, basePath + entry.name + '/')));
    return results.flat();
  }
  return [];
}

export default function ImportPage({ onImported }) {
  const { data: categoriesData, refetch: refetchCats } = useApi('/api/categories');
  const categories = categoriesData || [];

  const { data: configData, refetch: refetchConfig } = useApi('/api/config');
  const [watchEnabled, setWatchEnabled] = useState(true);
  const [watchDir, setWatchDir] = useState('');
  const [watchMsg, setWatchMsg] = useState('');
  const watchStatus = configData?.status || {};

  useEffect(() => {
    if (configData?.watch) {
      setWatchEnabled(!!configData.watch.enabled);
      setWatchDir(configData.watch.dir || '');
    }
  }, [configData]);

  const saveWatch = async () => {
    setWatchMsg('');
    try {
      await api.patch('/api/config', { watch: { enabled: watchEnabled, dir: watchDir } });
      refetchConfig();
      setWatchMsg('已保存并应用');
      setTimeout(() => setWatchMsg(''), 2500);
    } catch (err) {
      setWatchMsg(err.message);
    }
  };

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [dragover, setDragover] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | parsing | preview | committing | done
  const [preview, setPreview] = useState(null); // {previewToken, items, stats}
  const [decisions, setDecisions] = useState({}); // localId -> {include, categoryId}
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const reset = () => {
    setPhase('idle');
    setPreview(null);
    setDecisions({});
    setError('');
    setResult(null);
  };

  const parseFiles = async (filePairs) => {
    if (!filePairs.length) return;
    setPhase('parsing');
    setError('');
    setResult(null);

    const form = new FormData();
    const names = [];
    const rels = [];
    for (const { file, relPath } of filePairs) {
      if (!/\.(md|markdown|txt)$/i.test(file.name) && !/\.(md|markdown|txt)$/i.test(relPath || '')) continue;
      form.append('files', file, file.name);
      names.push(encodeURIComponent(file.name));
      rels.push(encodeURIComponent(relPath || file.name));
    }
    if (names.length === 0) {
      setPhase('idle');
      setError('没有找到 .md / .markdown / .txt 文件');
      return;
    }
    form.append('nameHints', names.join(SEP));
    form.append('relPaths', rels.join(SEP));

    try {
      const res = await fetch('/api/import/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '解析失败');
      setPreview(data);
      const initial = {};
      for (const item of data.items) {
        initial[item.localId] = {
          include: item.include,
          categoryId: item.suggestedCategoryId,
          // 重复但答案有更新的旧题，默认勾选「更新答案」
          updateAnswer: !!item.isUpdated,
        };
      }
      setDecisions(initial);
      setPhase('preview');
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragover(false);
    const pairs = await readAllEntries(e.dataTransfer);
    if (pairs && pairs.length) {
      parseFiles(pairs);
    } else {
      // 退化：直接取文件
      const files = Array.from(e.dataTransfer.files || []);
      parseFiles(files.map((file) => ({ file, relPath: file.name })));
    }
  };

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    parseFiles(files.map((file) => ({ file, relPath: file.webkitRelativePath || file.name })));
    e.target.value = '';
  };

  const setDecision = (localId, patch) => {
    setDecisions((d) => ({ ...d, [localId]: { ...d[localId], ...patch } }));
  };

  const toggleAll = (include) => {
    const next = {};
    for (const item of preview.items) {
      if (item.error) continue;
      next[item.localId] = {
        include,
        categoryId: decisions[item.localId]?.categoryId || item.suggestedCategoryId,
        updateAnswer: decisions[item.localId]?.updateAnswer,
      };
    }
    setDecisions(next);
  };

  const commit = async () => {
    setPhase('committing');
    setError('');
    try {
      const items = preview.items.map((item) => ({
        localId: item.localId,
        include: !!decisions[item.localId]?.include,
        categoryId: decisions[item.localId]?.categoryId || item.suggestedCategoryId,
        updateAnswer: !!decisions[item.localId]?.updateAnswer,
      }));
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewToken: preview.previewToken, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      setResult(data);
      setPhase('done');
      onImported?.();
      refetchCats();
    } catch (err) {
      setError(err.message);
      setPhase('preview');
    }
  };

  const includedCount = preview
    ? preview.items.filter((i) => !i.error && decisions[i.localId]?.include).length
    : 0;
  const suggestedByLabel = {
    'front-matter': 'front-matter',
    path: '路径',
    tags: '标签',
    keywords: '关键词',
    fallback: '兜底',
    error: '错误',
  };

  return (
    <div className="page-container">
      {phase === 'idle' || phase === 'parsing' ? (
        <>
          <div
            className={`dropzone${dragover ? ' dragover' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragover(true);
            }}
            onDragLeave={() => setDragover(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <div className="drop-icon">📥</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {phase === 'parsing' ? '解析中…' : '拖拽 markdown 文件或文件夹到这里'}
            </div>
            <div style={{ marginTop: 4, fontSize: 13 }}>
              也可以点击选择文件；支持单文件多题（<code>## </code> 分隔）、front-matter、自动去重
            </div>
            <div className="drop-actions">
              <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                选择文件
              </button>
              <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}>
                选择文件夹
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            style={{ display: 'none' }}
            onChange={onPick}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            webkitdirectory=""
            directory=""
            style={{ display: 'none' }}
            onChange={onPick}
          />

          <div className="card" style={{ padding: '16px 20px', marginTop: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>支持的 markdown 格式</div>
            <ul className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
              <li>文件头部可写 front-matter：<code>---</code> 包裹的 <code>title / category / tags</code></li>
              <li>文件里每个 <code>## 二级标题</code> 切成一道题，标题即题目名；没有二级标题则整个文件算一题</li>
              <li>
                <code>## 答案</code> / <code>### 参考答案</code> / <code>**答案**：</code> 或正文中的 <code>---</code> 分隔线之后视为答案
              </li>
              <li>文件名/文件夹名含「前端」「算法」等会自动归类，导入预览里可逐题修改</li>
            </ul>
          </div>

          <div className="card" style={{ padding: '16px 20px', marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700 }}>📁 自动导入（监控文件夹）</div>
              <span className="faint">
                {!watchStatus.enabled ? '已停用' : watchStatus.watching ? `监控中 · 目录内 ${watchStatus.files || 0} 个文件` : '已启用（未就绪）'}
              </span>
              {watchStatus.lastAt ? (
                <span className="faint">· 最近：{watchStatus.lastEvent}（新增 {watchStatus.lastAdded} / 更新 {watchStatus.lastUpdated}）</span>
              ) : null}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              把 markdown 丢进下面这个文件夹，服务会自动解析入库；同名题目自动去重，文件改动后会同步答案。
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="scope-toggle" title="开关监控">
                <input type="checkbox" checked={watchEnabled} onChange={(e) => setWatchEnabled(e.target.checked)} />
                启用
              </label>
              <input
                className="input"
                style={{ flex: 1, minWidth: 240 }}
                value={watchDir}
                onChange={(e) => setWatchDir(e.target.value)}
                placeholder="文件夹绝对路径，如 D:\\题目暂存"
              />
              <button type="button" className="btn sm primary" onClick={saveWatch}>保存并应用</button>
            </div>
            {watchMsg ? <div className="faint" style={{ marginTop: 8 }}>{watchMsg}</div> : null}
          </div>
        </>
      ) : null}

      {phase === 'preview' && preview ? (
        <>
          <div className="toolbar">
            <strong>导入预览</strong>
            <span className="muted">
              共 {preview.stats.total} 题 · 新增 {preview.stats.new} · 重复 {preview.stats.dup}
              {preview.stats.updated ? ` · 可更新答案 ${preview.stats.updated}` : ''}
            </span>
            <span className="spacer" />
            <button type="button" className="btn sm" onClick={() => toggleAll(true)}>全选新题</button>
            <button type="button" className="btn sm" onClick={() => toggleAll(false)}>全不选</button>
            <button type="button" className="btn sm" onClick={reset}>放弃</button>
          </div>

          <div className="card" style={{ overflow: 'auto', maxHeight: '55vh' }}>
            <table className="import-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>题目</th>
                  <th style={{ width: 140 }}>分类</th>
                  <th style={{ width: 110 }}>来源</th>
                  <th style={{ width: 80 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => {
                  const d = decisions[item.localId] || {};
                  return (
                    <tr key={item.localId} className={item.isDuplicate ? 'dup-row' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!!item.error}
                          checked={!!d.include}
                          onChange={(e) => setDecision(item.localId, { include: e.target.checked })}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.title}</div>
                        <div className="faint" title={item.sourcePath}>{item.sourcePath}</div>
                        {item.error ? <div className="error-text">{item.error}</div> : null}
                      </td>
                      <td>
                        <select
                          className="select"
                          value={d.categoryId || item.suggestedCategoryId}
                          onChange={(e) => setDecision(item.localId, { categoryId: e.target.value })}
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="faint">{item.sourceFile}</td>
                      <td>
                        {item.isDuplicate ? (
                          <>
                            <span className={`badge ${item.isUpdated ? 'update' : 'dup'}`}>
                              {item.isUpdated ? '有更新' : '重复'}
                            </span>
                            {item.isUpdated ? (
                              <label className="update-check" title="用新导入的答案替换库里该题的答案，不新增重复题">
                                <input
                                  type="checkbox"
                                  checked={!!d.updateAnswer}
                                  onChange={(e) => setDecision(item.localId, { updateAnswer: e.target.checked })}
                                />
                                更新答案
                              </label>
                            ) : null}
                          </>
                        ) : (
                          <span className="faint">建议：{suggestedByLabel[item.suggestedBy] || item.suggestedBy}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="confirm-bar">
            <span className="muted">已选择 <strong>{includedCount}</strong> 题导入</span>
            <span className="spacer" style={{ flex: 1 }} />
            {error ? <span className="error-text">{error}</span> : null}
            <button type="button" className="btn primary" onClick={commit} disabled={includedCount === 0}>
              确认导入
            </button>
          </div>
        </>
      ) : null}

      {phase === 'done' && result ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 8 }}>
            导入完成：新增 {result.added} 题
            {result.updated ? `，更新答案 ${result.updated} 题` : ''}
            {result.skipped ? `，跳过 ${result.skipped} 题` : ''}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {result.added > 0 || result.updated > 0 ? '题目已入库，快去题库看看吧' : '没有新增题目（可能都是重复的）'}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
            <button type="button" className="btn" onClick={reset}>继续导入</button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const prev = new URLSearchParams();
                prev.set('sort', 'createdAtDesc');
                window.location.href = `/?${prev.toString()}`;
              }}
            >
              查看题库
            </button>
          </div>
        </div>
      ) : null}

      {error && phase !== 'preview' && phase !== 'done' ? (
        <div className="error-text" style={{ marginTop: 14 }}>{error}</div>
      ) : null}
    </div>
  );
}
