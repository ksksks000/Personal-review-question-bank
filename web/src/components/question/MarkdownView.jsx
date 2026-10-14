import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export default function MarkdownView({ children }) {
  if (!children || !String(children).trim()) {
    return <div className="faint">（暂无内容）</div>;
  }
  return (
    <div className="md-view">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {String(children)}
      </ReactMarkdown>
    </div>
  );
}
