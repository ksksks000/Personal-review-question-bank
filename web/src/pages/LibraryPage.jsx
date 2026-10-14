import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import QuestionListItem from '../components/question/QuestionListItem.jsx';
import QuestionEditorDrawer from '../components/question/QuestionEditorDrawer.jsx';

export default function LibraryPage({ categories, onCategoriesChange }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  const q = params.get('q') || '';
  const categoryId = params.get('categoryId') || '';
  const mastery = params.get('mastery') || '';
  const scope = params.get('scope') || '';
  const due = params.get('due') || '';
  const page = parseInt(params.get('page'), 10) || 1;
  const pageSize = 20;

  const query = useMemo(
    () => qs({ q, categoryId, mastery, scope, due, page, pageSize, sort: 'updatedAtDesc' }),
    [q, categoryId, mastery, scope, due, page],
  );

  const { data, loading, error, refetch } = useApi(`/api/questions${query}`);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set()); // 筛选/翻页变化时清空选择
  };

  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = data?.items || [];

  const startPractice = () => {
    const search = new URLSearchParams();
    if (categoryId) search.set('categoryId', categoryId);
    if (mastery) search.set('mastery', mastery);
    if (q) search.set('q', q);
    if (scope === 'full') search.set('scope', 'full');
    if (due === '1') search.set('due', '1');
    search.set('mode', 'sequence');
    navigate(`/practice?${search.toString()}`);
  };

  const addQuestion = async () => {
    try {
      const created = await api.post('/api/questions', {
        title: '新题目',
        content: '',
        answer: '',
        categoryId: categoryId || 'uncategorized',
      });
      onCategoriesChange?.();
      refetch();
      setEditingId(created.id);
    } catch (err) {
      window.alert(err.message);
    }
  };

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggleSelectAll = () => {
    const next = new Set(selected);
    if (allSelected) items.forEach((i) => next.delete(i.id));
    else items.forEach((i) => next.add(i.id));
    setSelected(next);
  };
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const applyBatchCategory = async (categoryId) => {
    const ids = [...selected];
    setSelected(new Set());
    try {
      await api.post('/api/questions/batch-update', { ids, categoryId });
      refetch();
      onCategoriesChange?.();
    } catch (err) {
      window.alert(err.message);
    }
  };
  const batchDelete = async () => {
    if (!window.confirm(`确定删除选中的 ${selected.size} 题？此操作不可撤销。`)) return;
    const ids = [...selected];
    setSelected(new Set());
    try {
      await api.post('/api/questions/batch-delete', { ids });
      refetch();
      onCategoriesChange?.();
    } catch (err) {
      window.alert(err.message);
    }
  };

  return (
    <div className="page-container">
      <div className="toolbar">
        {due === '1' ? <span className="tag-chip">🔁 今日待复习</span> : null}
        {mastery === 'learning' ? <span className="tag-chip">📕 错题本</span> : null}
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            className="input"
            placeholder="搜索题目、标签…"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        <label className="scope-toggle" title="同时搜索题干与参考答案正文">
          <input
            type="checkbox"
            checked={scope === 'full'}
            onChange={() => setParam('scope', scope === 'full' ? '' : 'full')}
          />
          全文
        </label>
        <select className="select" style={{ width: 130 }} value={categoryId} onChange={(e) => setParam('categoryId', e.target.value)}>
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}（{c.count}）</option>
          ))}
        </select>
        <select className="select" style={{ width: 120 }} value={mastery} onChange={(e) => setParam('mastery', e.target.value)}>
          <option value="">全部状态</option>
          <option value="unseen">未刷</option>
          <option value="learning">不熟</option>
          <option value="mastered">已掌握</option>
        </select>
        <span className="spacer" />
        <button type="button" className="btn" onClick={addQuestion}>＋ 新建题目</button>
        <button type="button" className="btn primary" onClick={startPractice} disabled={total === 0}>
          🎯 开始刷题
        </button>
      </div>

      {items.length > 0 ? (
        <div className="toolbar batch-toolbar">
          <label className="scope-toggle" title="勾选当前页全部题目">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            全选本页
          </label>
          {selected.size > 0 ? (
            <>
              <span className="selected-count">已选 <strong>{selected.size}</strong> 题</span>
              <select
                className="select"
                style={{ width: 140 }}
                value=""
                onChange={(e) => { if (e.target.value) applyBatchCategory(e.target.value); }}
              >
                <option value="">移动到分类…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button type="button" className="btn sm danger" onClick={batchDelete}>🗑 删除选中</button>
              <button type="button" className="btn sm ghost" onClick={() => setSelected(new Set())}>取消选择</button>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? <div className="empty-state">加载中…</div> : null}
      {error ? <div className="empty-state error-text">{error}</div> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <div>{q || categoryId || mastery || due ? '没有匹配的题目' : '题库还是空的，去「导入」页添加你的第一份题目吧'}</div>
          {!(q || categoryId || mastery) ? (
            <button type="button" className="btn primary" style={{ marginTop: 14 }} onClick={() => navigate('/import')}>
              去导入
            </button>
          ) : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="q-list">
            {items.map((item) => (
              <QuestionListItem
                key={item.id}
                question={item}
                categories={categories}
                onClick={() => setEditingId(item.id)}
                selected={selected.has(item.id)}
                onToggleSelected={toggleSelect}
              />
            ))}
          </div>
          <div className="pagination">
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
              上一页
            </button>
            <span>第 {page} / {totalPages} 页 · 共 {total} 题</span>
            <button type="button" className="btn sm" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>
              下一页
            </button>
          </div>
        </>
      ) : null}

      {editingId ? (
        <QuestionEditorDrawer
          questionId={editingId}
          categories={categories}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            refetch();
            onCategoriesChange?.();
          }}
          onDeleted={() => {
            refetch();
            onCategoriesChange?.();
          }}
        />
      ) : null}
    </div>
  );
}
