import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import MarkdownView from '../components/question/MarkdownView.jsx';
import MasteryBadge from '../components/common/MasteryBadge.jsx';

const MASTERY_LABELS = [
  { value: 'unseen', label: '1 未刷', key: '1' },
  { value: 'learning', label: '2 不熟', key: '2' },
  { value: 'mastered', label: '3 已掌握', key: '3' },
];

/** 拉取筛选条件下的全部题目 id（分页拉完，最多 1000） */
async function fetchAllIds(params) {
  const ids = [];
  const pageSize = 100;
  let page = 1;
  let total = Infinity;
  while (ids.length < total && ids.length < 1000) {
    const data = await api.get(`/api/questions${qs({ ...params, page, pageSize })}`);
    total = data.total;
    ids.push(...data.items.map((item) => item.id));
    if (data.items.length === 0) break;
    page++;
  }
  return { ids, total };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function PracticePage({ categories }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const filterParams = useMemo(() => {
    const out = {};
    for (const key of ['q', 'categoryId', 'mastery', 'tag', 'scope', 'due']) {
      const v = params.get(key);
      if (v) out[key] = v;
    }
    return out;
  }, [params]);

  const mode = params.get('mode') || 'sequence';

  const [order, setOrder] = useState(null); // id 序列
  const [index, setIndex] = useState(0);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false); // 参考答案默认折叠，点开/空格才显示
  const cacheRef = useRef(new Map());

  const categoryId = filterParams.categoryId;
  const currentId = order && order[index];

  // 进入/换筛选条件时重建序列
  const filterKey = JSON.stringify(filterParams) + mode;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setCurrent(null);
    setIndex(0);
    cacheRef.current = new Map();

    fetchAllIds(filterParams)
      .then(({ ids, total }) => {
        if (cancelled) return;
        setTotalFiltered(total);
        setOrder(mode === 'shuffle' ? shuffle(ids) : ids);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 翻到新题时把答案重新折叠起来
  useEffect(() => {
    setShowAnswer(false);
  }, [currentId]);

  // 按需加载当前题
  useEffect(() => {
    if (!currentId) {
      setCurrent(null);
      return;
    }
    if (cacheRef.current.has(currentId)) {
      setCurrent(cacheRef.current.get(currentId));
      return;
    }
    let cancelled = false;
    api
      .get(`/api/questions/${currentId}`)
      .then((q) => {
        if (cancelled) return;
        cacheRef.current.set(currentId, q);
        setCurrent(q);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const go = useCallback(
    (delta) => {
      setIndex((i) => {
        const next = i + delta;
        if (next < 0 || !order || next >= order.length) return i;
        return next;
      });
    },
    [order],
  );

  const setMastery = useCallback(
    async (value) => {
      if (!current) return;
      const prev = current.mastery;
      setCurrent((c) => ({ ...c, mastery: value }));
      try {
        await api.patch(`/api/questions/${current.id}`, { mastery: value });
      } catch {
        setCurrent((c) => ({ ...c, mastery: prev }));
      }
    },
    [current],
  );

  // 键盘快捷键
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.code === 'Space' && current?.answer) {
        e.preventDefault();
        setShowAnswer(true);
      } else if (e.key === '1') setMastery('unseen');
      else if (e.key === '2') setMastery('learning');
      else if (e.key === '3') setMastery('mastered');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [go, setMastery, current]);

  const cat = categories.find((c) => c.id === categoryId);
  const hasFilter = Object.keys(filterParams).length > 0;

  const toggleMode = () => {
    const next = new URLSearchParams(params);
    next.set('mode', mode === 'shuffle' ? 'sequence' : 'shuffle');
    navigate(`/practice?${next.toString()}`, { replace: true });
  };

  const backToLibrary = () => {
    const next = new URLSearchParams(filterParams);
    navigate(next.toString() ? `/?${next.toString()}` : '/');
  };

  if (loading) {
    return <div className="empty-state">准备题单中…</div>;
  }
  if (error) {
    return <div className="empty-state error-text">{error}</div>;
  }
  if (!order || order.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎯</div>
        <div>{hasFilter ? '当前筛选条件下没有题目' : '题库还是空的，先去导入题目'}</div>
        <button type="button" className="btn primary" style={{ marginTop: 14 }} onClick={backToLibrary}>
          返回题库
        </button>
      </div>
    );
  }

  return (
    <div className="practice-container">
      <div className="practice-toolbar">
        <button type="button" className="btn sm" onClick={backToLibrary}>← 返回</button>
        {cat ? <span className="tag-chip">{cat.name}</span> : null}
        <span className="spacer" style={{ flex: 1 }} />
        <span className="progress">
          {index + 1} / {order.length}
          {totalFiltered > order.length ? `（筛选共 ${totalFiltered}）` : ''}
        </span>
        <button type="button" className="btn sm" onClick={toggleMode} title="切换顺序/随机">
          {mode === 'shuffle' ? '🔀 随机' : '➡️ 顺序'}
        </button>
        <button type="button" className="btn sm" onClick={() => setIndex(Math.floor(Math.random() * order.length))}>
          🎲 跳到随机一题
        </button>
      </div>

      <div className="card practice-card">
        {!current ? (
          <div className="muted">加载中…</div>
        ) : (
          <>
            <div className="practice-title">{current.title}</div>
            <div className="practice-tags">
              <MasteryBadge mastery={current.mastery} />
              {(current.tags || []).map((t) => (
                <span key={t} className="alias-chip">{t}</span>
              ))}
            </div>
            <MarkdownView>{current.content}</MarkdownView>
            {current.answer ? (
              showAnswer ? (
                <>
                  <hr className="answer-divider" />
                  <div className="answer-label">参考答案</div>
                  <MarkdownView>{current.answer}</MarkdownView>
                </>
              ) : (
                <div className="answer-reveal">
                  <button type="button" className="btn" onClick={() => setShowAnswer(true)}>
                    👁 显示参考答案
                  </button>
                  <span className="faint">先在心里过一遍，再点开对照</span>
                </div>
              )
            ) : null}
          </>
        )}
      </div>

      <div className="practice-toolbar" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn" onClick={() => go(-1)} disabled={index <= 0}>
          ← 上一题
        </button>
        {MASTERY_LABELS.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`btn sm${current?.mastery === m.value ? ' primary' : ''}`}
            onClick={() => setMastery(m.value)}
            title={`快捷键 ${m.key}`}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => go(1)}
          disabled={index >= order.length - 1}
        >
          下一题 →
        </button>
      </div>
      <div className="faint" style={{ textAlign: 'center', paddingBottom: 12 }}>
        快捷键：← → 翻题 · 空格 看答案 · 1 未刷 · 2 不熟 · 3 已掌握
      </div>
    </div>
  );
}
