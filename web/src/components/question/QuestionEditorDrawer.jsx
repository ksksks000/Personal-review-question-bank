import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import MarkdownView from './MarkdownView.jsx';

const MASTERY_OPTIONS = [
  { value: 'unseen', label: '未刷' },
  { value: 'learning', label: '不熟' },
  { value: 'mastered', label: '已掌握' },
];

export default function QuestionEditorDrawer({ questionId, categories, onClose, onSaved, onDeleted }) {
  const [question, setQuestion] = useState(null);
  const [form, setForm] = useState(null);
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!questionId) return;
    api.get(`/api/questions/${questionId}`).then((q) => {
      setQuestion(q);
      setForm({
        title: q.title,
        categoryId: q.categoryId,
        mastery: q.mastery,
        content: q.content,
        answer: q.answer,
      });
      setTagsText((q.tags || []).join(', '));
    }).catch((err) => setError(err.message));
  }, [questionId]);

  if (!question || !form) {
    return (
      <div className="drawer-mask" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-body muted">加载中…</div>
        </div>
      </div>
    );
  }

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/questions/${question.id}`, {
        ...form,
        tags: tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除这道题？此操作不可恢复。')) return;
    try {
      await api.del(`/api/questions/${question.id}`);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="title">编辑题目</div>
          <button type="button" className="btn ghost sm" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? '编辑模式' : '预览'}
          </button>
          <button type="button" className="btn ghost sm" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {error ? <div className="error-text">{error}</div> : null}

          <div className="form-row">
            <label>标题</label>
            <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>分类</label>
              <select className="select" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>掌握状态</label>
              <select className="select" value={form.mastery} onChange={(e) => set('mastery', e.target.value)}>
                {MASTERY_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>标签（逗号分隔）</label>
            <input className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="如：css, 布局" />
          </div>

          <div className="form-row">
            <label>题干（Markdown）</label>
            {showPreview ? <MarkdownView>{form.content}</MarkdownView> : (
              <textarea className="textarea" rows={8} value={form.content} onChange={(e) => set('content', e.target.value)} />
            )}
          </div>

          <div className="form-row">
            <label>答案（Markdown）</label>
            {showPreview ? <MarkdownView>{form.answer}</MarkdownView> : (
              <textarea className="textarea" rows={8} value={form.answer} onChange={(e) => set('answer', e.target.value)} />
            )}
          </div>

          {question.sourceFile ? (
            <div className="faint">来源文件：{question.sourceFile}</div>
          ) : null}
        </div>

        <div className="drawer-footer">
          <button type="button" className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>删除</button>
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
