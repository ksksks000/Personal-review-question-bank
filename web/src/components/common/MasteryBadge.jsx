const LABELS = {
  unseen: '未刷',
  learning: '不熟',
  mastered: '已掌握',
};

export default function MasteryBadge({ mastery }) {
  return <span className={`badge ${mastery || 'unseen'}`}>{LABELS[mastery] || LABELS.unseen}</span>;
}
