import matter from 'gray-matter';
import { marked } from 'marked';

const ANSWER_HEADING_RE = /^(答案|参考答案|解答|解析|回答|answer)$/i;

function isAnswerHeading(text) {
  return ANSWER_HEADING_RE.test(String(text || '').trim().replace(/[*：:]/g, ''));
}

function stripMdHeading(text) {
  return String(text || '').replace(/^#{1,6}\s+/, '').trim();
}

/**
 * 单个 markdown 文件 → 题目数组。
 *
 * 约定：
 * - front-matter（可选）支持 title/category/tags，对整文件内所有题生效
 * - 含 `## ` h2 → 每个 h2 切一题，h2 文本为 title；无 h2 → 整文件一题
 * - h2 文本为「答案/参考答案/解答/解析」等 → 不是新题，是当前题的答案起点
 * - 答案分离：答案标题之后为答案；否则正文第一个 `---` 分隔线之后为答案
 *
 * @returns {Array<{title, content, answer, tags, category}>}
 */
export function splitMarkdown(raw, defaultTitle) {
  const source = String(raw || '').replace(/\r\n?/g, '\n');
  const { data: front, content: body } = matter(source);
  const fmTitle = typeof front.title === 'string' ? front.title.trim() : '';
  const fmCategory = typeof front.category === 'string' ? front.category.trim() : '';
  const fmTags = Array.isArray(front.tags)
    ? front.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const tokens = marked.lexer(body);
  const headingLevels = tokens.filter((t) => t.type === 'heading').map((t) => t.depth);
  const hasH2 = headingLevels.includes(2);

  if (!hasH2) {
    // 整文件一题
    const h1 = tokens.find((t) => t.type === 'heading' && t.depth === 1);
    const title = fmTitle || (h1 ? stripMdHeading(h1.text) : '') || defaultTitle;
    const { content, answer } = splitAnswer(body);
    return [{ title, content: content.trim(), answer: answer.trim(), tags: fmTags, category: fmCategory }];
  }

  // 有 h2：按 h2 切分
  const sections = [];
  let current = null;
  let fileIntro = ''; // 第一个 h2 之前的内容（非答案前提下仅作文档说明，若含答案则挂到暂无题上）

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 2) {
      if (current) sections.push(current);
      current = { heading: stripMdHeading(token.text), bodyTokens: [], bodyStart: token.raw };
      continue;
    }
    if (current) {
      current.bodyTokens.push(token);
      current.bodyStart += token.raw;
    } else {
      fileIntro += token.raw;
    }
  }
  if (current) sections.push(current);

  const questions = [];
  let pendingAnswer = null; // 答案 h2 出现时，追加到前一题
  let prevQuestion = null;

  for (const sec of sections) {
    if (isAnswerHeading(sec.heading)) {
      // 不是新题：其后内容为前一题的答案
      const answerText = sec.bodyTokens.map((t) => t.raw).join('');
      if (prevQuestion) {
        prevQuestion.answer = answerText.trim();
      } else {
        pendingAnswer = answerText; // 文件以答案开头（罕见），暂存
      }
      continue;
    }
    const body = sec.bodyTokens.map((t) => t.raw).join('');
    const { content, answer } = splitAnswer(body);
    const q = {
      title: sec.heading,
      content: content.trim(),
      answer: answer.trim(),
      tags: fmTags,
      category: fmCategory,
    };
    if (pendingAnswer && !q.answer) {
      q.answer = pendingAnswer.trim();
      pendingAnswer = null;
    }
    questions.push(q);
    prevQuestion = q;
  }

  // 首个 h2 之前的 front-matter title：若只有一题且 h2 标题平平，用 fmTitle 覆盖
  if (fmTitle && questions.length === 1) {
    questions[0].title = fmTitle;
  }
  if (questions.length === 0 && (body.trim() || fileIntro.trim())) {
    const { content, answer } = splitAnswer(body || fileIntro);
    questions.push({
      title: fmTitle || defaultTitle,
      content: content.trim(),
      answer: answer.trim(),
      tags: fmTags,
      category: fmCategory,
    });
  }

  return questions;
}

/**
 * 答案分离：
 * 1. 答案标题（## 答案 / **答案**： 等）
 * 2. 否则正文中间第一个 `---` 分隔线，其后为答案
 */
function splitAnswer(body) {
  const text = String(body || '');

  // 形式一：独立行的答案标题（#..#### 或 **答案**）
  const headingRe = /^(?:#{1,4}\s*)?(?:答案|参考答案|解答|解析|回答)\s*[：:]?\s*$|^\*\*(?:答案|参考答案|解答|解析)\**\s*[：:]?/gm;
  const m = headingRe.exec(text);
  if (m && m.index > 0) {
    let cut = m.index;
    // 去掉答案标题前的空行
    return { content: text.slice(0, cut), answer: text.slice(cut + m[0].length) };
  }
  if (m && m.index === 0) {
    return { content: '', answer: text.slice(m[0].length) };
  }

  // 形式二：正文中间的 --- 分隔线
  const lines = text.split('\n');
  for (let i = 1; i < lines.length - 0; i++) {
    const line = lines[i].trim();
    if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(line)) {
      const before = lines.slice(0, i).join('\n');
      const after = lines.slice(i + 1).join('\n');
      if (before.trim() && after.trim()) {
        return { content: before, answer: after };
      }
    }
  }
  return { content: text, answer: '' };
}
