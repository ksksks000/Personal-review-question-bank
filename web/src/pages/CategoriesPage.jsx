import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';

export default function CategoriesPage({ onCategoriesChange }) {
  const { data: categoriesData, loading, error, refetch } = useApi('/api/categories');
  const categories = categoriesData || [];
  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', aliases: '' });
  const [actionError, setActionError] = useState('');

  const toAliasesText = (aliases) => (aliases || []).join(', ');

  const addCategory = async () => {
    setActionError('');
    if (!newName.trim()) return;
    try {
      await api.post('/api/categories', {
        name: newName.trim(),
        aliases: newAliases.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      setNewName('');
      setNewAliases('');
      refetch();
      onCategoriesChange?.();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditForm({ name: cat.name, aliases: toAliasesText(cat.aliases) });
    setActionError('');
  };

  const saveEdit = async () => {
    setActionError('');
    try {
      await api.patch(`/api/categories/${editingId}`, {
        name: editForm.name.trim(),
        aliases: editForm.aliases.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      setEditingId(null);
      refetch();
      onCategoriesChange?.();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const removeCategory = async (cat) => {
    if (!window.confirm(`删除分类「${cat.name}」？该分类下的 ${cat.count} 道题会归入「未分类」。`)) return;
    setActionError('');
    try {
      await api.del(`/api/categories/${cat.id}`);
      refetch();
      onCategoriesChange?.();
    } catch (err) {
      setActionError(err.message);
    }
  };

  if (loading) return <div className="empty-state">加载中…</div>;
  if (error) return <div className="empty-state error-text">{error}</div>;

  return (
    <div className="page-container">
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>新增分类</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ width: 160 }}
            placeholder="分类名，如：系统设计"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="别名（逗号分隔），影响导入时自动归类，如：system design, 架构"
            value={newAliases}
            onChange={(e) => setNewAliases(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <button type="button" className="btn primary" onClick={addCategory}>添加</button>
        </div>
        {actionError ? <div className="error-text" style={{ marginTop: 8 }}>{actionError}</div> : null}
        <div className="faint" style={{ marginTop: 8 }}>
          别名用于导入 markdown 时的自动分类识别：文件名、路径、front-matter 或标签命中别名即归入该分类。
        </div>
      </div>

      <div className="card">
        {categories.map((cat) =>
          editingId === cat.id ? (
            <div className="category-row" key={cat.id}>
              <input
                className="input"
                style={{ width: 130 }}
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                value={editForm.aliases}
                onChange={(e) => setEditForm((f) => ({ ...f, aliases: e.target.value }))}
              />
              <button type="button" className="btn primary sm" onClick={saveEdit}>保存</button>
              <button type="button" className="btn sm" onClick={() => setEditingId(null)}>取消</button>
            </div>
          ) : (
            <div className="category-row" key={cat.id}>
              <span className="cat-name">{cat.name}</span>
              <span className="badge unseen">{cat.count} 题</span>
              <div className="cat-aliases">
                {(cat.aliases || []).map((a) => (
                  <span className="alias-chip" key={a}>{a}</span>
                ))}
                {!(cat.aliases || []).length ? <span className="faint">无别名</span> : null}
              </div>
              {!cat.system ? (
                <>
                  <button type="button" className="btn ghost sm" onClick={() => startEdit(cat)}>编辑</button>
                  <button type="button" className="btn ghost sm" onClick={() => removeCategory(cat)} style={{ color: 'var(--danger)' }}>
                    删除
                  </button>
                </>
              ) : (
                <span className="faint">内置</span>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
