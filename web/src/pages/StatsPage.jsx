import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api/client.js';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function StatsPage({ onCategoriesChange }) {
  const { data, loading, error, refetch } = useApi('/api/stats');
  const navigate = useNavigate();
  const restoreInputRef = useRef(null);

  const restoreFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      window.alert('不是有效的备份文件（JSON 解析失败）');
      return;
    }
    if (!Array.isArray(data.categories) || !Array.isArray(data.questions)) {
      window.alert('备份文件结构不合法');
      return;
    }
    if (
      !window.confirm(
        `将用备份中的 ${data.questions.length} 道题、${data.categories.length} 个分类替换整个题库\n\n当前题库会被覆盖，确定继续吗？`,
      )
    ) {
      return;
    }
    try {
      const result = await api.post('/api/backup/restore', data);
      onCategoriesChange?.();
      refetch();
      window.alert(`已恢复：${result.questions} 道题，${result.categories} 个分类`);
    } catch (err) {
      window.alert(err.message);
    }
  };

  if (loading) return <div className="empty-state">加载中…</div>;
  if (error) return <div className="empty-state error-text">{error}</div>;

  const { total, byCategory, byMastery, dueCount, recentImports } = data;
  const maxCat = Math.max(1, ...byCategory.map((c) => c.count));
  const masteryTotal = Math.max(1, byMastery.unseen + byMastery.learning + byMastery.mastered);
  const pct = (n) => `${Math.round((n / masteryTotal) * 100)}%`;

  return (
    <div className="page-container">
      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">题目总数</div>
        </div>
        <div
          className="card stat-card"
          style={{ cursor: 'pointer' }}
          title="开始今日复习"
          onClick={() => navigate('/practice?due=1')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/practice?due=1'); }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{dueCount}</div>
          <div className="stat-label">今日复习（点我开刷）</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{byMastery.mastered}</div>
          <div className="stat-label">已掌握</div>
        </div>
        <div
          className="card stat-card"
          style={{ cursor: 'pointer' }}
          title="一键开始刷不熟的题"
          onClick={() => navigate('/practice?mastery=learning')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/practice?mastery=learning'); }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{byMastery.learning}</div>
          <div className="stat-label">不熟（点我开刷）</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{byMastery.unseen}</div>
          <div className="stat-label">未刷</div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>备份与恢复</div>
        <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
          服务每次启动会自动备份数据到 <code>data/backups/</code>（保留最近 10 份）。也可以手动导出完整备份文件，
          换电脑或数据丢失时用它在空题库上恢复。
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn sm" href="/api/backup/export" download>⬇️ 导出备份 JSON</a>
          <button type="button" className="btn sm" onClick={() => restoreInputRef.current?.click()}>
            ↩️ 从备份恢复
          </button>
          <input ref={restoreInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={restoreFile} />
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>掌握进度</div>
        <div className="mastery-progress">
          <div className="seg-mastered" style={{ width: `${(byMastery.mastered / masteryTotal) * 100}%` }} />
          <div className="seg-learning" style={{ width: `${(byMastery.learning / masteryTotal) * 100}%` }} />
          <div className="seg-unseen" style={{ width: `${(byMastery.unseen / masteryTotal) * 100}%` }} />
        </div>
        <div className="legend">
          <span><span className="dot" style={{ background: 'var(--success)' }} />已掌握 {byMastery.mastered}（{pct(byMastery.mastered)}）</span>
          <span><span className="dot" style={{ background: 'var(--warning)' }} />不熟 {byMastery.learning}（{pct(byMastery.learning)}）</span>
          <span><span className="dot" style={{ background: 'var(--border-strong)' }} />未刷 {byMastery.unseen}（{pct(byMastery.unseen)}）</span>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>分类分布</div>
        {byCategory.length === 0 ? (
          <div className="muted">暂无数据</div>
        ) : (
          byCategory.map((c) => (
            <div className="bar-row" key={c.id}>
              <span className="muted">{c.name}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(c.count / maxCat) * 100}%` }} />
              </div>
              <span className="faint" style={{ textAlign: 'right' }}>{c.count}</span>
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>最近导入</div>
        {recentImports.length === 0 ? (
          <div className="muted">还没有导入记录</div>
        ) : (
          <table className="import-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>文件数</th>
                <th>新增</th>
                <th>更新</th>
                <th>跳过</th>
              </tr>
            </thead>
            <tbody>
              {recentImports.map((entry, i) => (
                <tr key={i}>
                  <td>{formatTime(entry.time)}</td>
                  <td>{entry.files}</td>
                  <td style={{ color: 'var(--success)' }}>+{entry.added}</td>
                  <td>{entry.updated ? <span style={{ color: 'var(--accent)' }}>+{entry.updated}</span> : '—'}</td>
                  <td className="muted">{entry.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
