import { Routes, Route, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { useApi } from './hooks/useApi.js';
import { useTheme } from './context/ThemeContext.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import PracticePage from './pages/PracticePage.jsx';
import ImportPage from './pages/ImportPage.jsx';
import StatsPage from './pages/StatsPage.jsx';
import CategoriesPage from './pages/CategoriesPage.jsx';

const NAV = [
  { to: '/', label: '题库', icon: '📚' },
  { to: '/practice', label: '刷题', icon: '🎯' },
  { to: '/import', label: '导入', icon: '📥' },
  { to: '/stats', label: '统计', icon: '📊' },
  { to: '/categories', label: '分类管理', icon: '🏷️' },
];

const TITLES = {
  '/': '题库',
  '/practice': '刷题',
  '/import': '导入',
  '/stats': '统计',
  '/categories': '分类管理',
};

function Sidebar({ categories, dueCount }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const activeCategory = params.get('categoryId') || '';
  const activeMastery = params.get('mastery') || '';
  const activeDue = params.get('due') === '1';
  const totalLearning = categories.reduce((sum, c) => sum + (c.learningCount || 0), 0);

  return (
    <aside className="sidebar">
      <div className="logo">📚 我的题库</div>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `nav-item${isActive && !(item.to === '/' && activeCategory) ? ' active' : ''}`}
        >
          <span>
            {item.icon} {item.label}
          </span>
        </NavLink>
      ))}
      <div className="sidebar-section-title">分类</div>
      <button
        type="button"
        className={`nav-item${location.pathname === '/' && activeDue ? ' active' : ''}`}
        onClick={() => navigate('/?due=1')}
      >
        <span>🔁 今日复习</span>
        <span className="count">{dueCount}</span>
      </button>
      <button
        type="button"
        className={`nav-item${location.pathname === '/' && activeMastery === 'learning' ? ' active' : ''}`}
        onClick={() => navigate('/?mastery=learning')}
      >
        <span>📕 错题本</span>
        <span className="count">{totalLearning}</span>
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          className={`nav-item${location.pathname === '/' && activeCategory === cat.id ? ' active' : ''}`}
          onClick={() => navigate(`/?categoryId=${encodeURIComponent(cat.id)}`)}
        >
          <span>{cat.name}</span>
          <span className="count">{cat.count}</span>
        </button>
      ))}
    </aside>
  );
}

function Topbar() {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const title = TITLES[location.pathname] || '题库';
  return (
    <header className="topbar">
      <div className="page-title">{title}</div>
      <button
        type="button"
        className="theme-toggle"
        onClick={toggle}
        title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </header>
  );
}

export default function App() {
  // key 加时间戳版本：分类页/导入页变更后可强制刷新侧栏计数
  const { data: categoriesData, refetch: refetchCats } = useApi('/api/categories');
  const { data: reviewData, refetch: refetchReview } = useApi('/api/review/summary');
  const categories = categoriesData || [];
  const dueCount = reviewData?.due || 0;
  const refetch = () => { refetchCats(); refetchReview(); };

  return (
    <div className="app-layout">
      <Sidebar categories={categories} dueCount={dueCount} />
      <div className="main-area">
        <Topbar />
        <main className="page-content">
          <Routes>
            <Route path="/" element={<LibraryPage categories={categories} onCategoriesChange={refetch} />} />
            <Route path="/practice" element={<PracticePage categories={categories} />} />
            <Route path="/import" element={<ImportPage onImported={refetch} />} />
            <Route path="/stats" element={<StatsPage onCategoriesChange={refetch} />} />
            <Route path="/categories" element={<CategoriesPage onCategoriesChange={refetch} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
