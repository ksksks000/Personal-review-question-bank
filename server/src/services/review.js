const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;

// 掌握状态 → SM-2 质量分（沿用现有三态标注，不引入额外判分）
const QUALITY = { mastered: 5, learning: 2 };

/**
 * 根据当前复习状态 + 本次掌握反馈，算出新的复习排程。
 * - 已掌握 → 质量 5：间隔 1 → 6 → 上次×ease 递增
 * - 不熟   → 质量 2：重置（reps=0, interval=1）
 * - 未刷   → 无排程（返回 null）
 * 标准 SM-2：EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))，EF ∈ [1.3, 2.8]
 */
export function scheduleReview(prev, mastery, now = new Date()) {
  const q = QUALITY[mastery];
  if (!q) return null;

  let ease = prev?.ease ?? 2.5;
  let interval = prev?.interval ?? 0;
  let reps = prev?.reps ?? 0;

  if (q < 3) {
    reps = 0;
    interval = 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  }
  ease = Math.min(MAX_EASE, Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));

  const nowMs = now.getTime();
  return {
    ease: Number(ease.toFixed(2)),
    interval,
    reps,
    dueAt: new Date(nowMs + interval * DAY_MS).toISOString(),
    lastAt: new Date(nowMs).toISOString(),
  };
}

/** 是否已到复习时间（无排程 = 不是复习题，返回 false） */
export function isDue(question, nowMs = Date.now()) {
  const dueAt = question?.review?.dueAt;
  return !!dueAt && Date.parse(dueAt) <= nowMs;
}
