import MasteryBadge from '../common/MasteryBadge.jsx';

export default function QuestionListItem({ question, categories, onClick, selected, onToggleSelected }) {
  const cat = categories.find((c) => c.id === question.categoryId);
  return (
    <div
      className={`card q-item${selected ? ' selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onClick(); }}
    >
      <div className="q-title-row">
        <input
          type="checkbox"
          className="q-checkbox"
          checked={!!selected}
          onChange={() => onToggleSelected(question.id)}
          onClick={(e) => e.stopPropagation()}
          title={selected ? '取消选择' : '勾选后可批量操作'}
        />
        <span className="q-title">{question.title}</span>
      </div>
      {question.excerpt ? <div className="q-excerpt">{question.excerpt}</div> : null}
      <div className="q-meta">
        <span className="tag-chip">{cat ? cat.name : '未分类'}</span>
        {(question.tags || []).slice(0, 4).map((t) => (
          <span key={t} className="alias-chip">{t}</span>
        ))}
        <span style={{ flex: 1 }} />
        <MasteryBadge mastery={question.mastery} />
      </div>
    </div>
  );
}
