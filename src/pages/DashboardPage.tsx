/**
 * DashboardPage —— 主控台首页
 *
 * 功能：
 * 1. 显示所有书籍列表
 * 2. 快速创建新书
 * 3. 书籍状态概览
 * 4. 快速导航到其他功能
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, BookOpen, BarChart2, CheckCircle2,
  MoreVertical, Flame, Trash2,
  Settings, Search,
} from "lucide-react";
import { fetchBooks, deleteBook, type BookSummary } from "../lib/api";
import { useMembership } from "../hooks/use-membership";

export function DashboardPage() {
  const navigate = useNavigate();
  const { isMember } = useMembership();
  const [books, setBooks] = useState<ReadonlyArray<BookSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBooks();
      setBooks(data);
    } catch (err) {
      console.error("Failed to load books:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const handleDelete = async (bookId: string) => {
    try {
      await deleteBook(bookId);
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
    } catch (err) {
      console.error("Failed to delete book:", err);
    }
    setConfirmDelete(null);
  };

  const filteredBooks = books.filter((book) => {
    const matchesSearch = book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      book.genre?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" ||
      (statusFilter === "in_progress" && book.status === "active") ||
      book.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "var(--success)";
      case "active": return "var(--warning)";
      case "incubating": return "var(--info)";
      case "outlining": return "var(--info)";
      case "paused": return "var(--text-dim)";
      case "dropped": return "var(--danger)";
      default: return "var(--text-dim)";
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "completed": return "已完成";
      case "active": return "创作中";
      case "incubating": return "孵化中";
      case "outlining": return "大纲中";
      case "paused": return "已暂停";
      case "dropped": return "已放弃";
      default: return "未知";
    }
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="dashboard-title">
          <h1>主控台</h1>
          <p>管理和追踪你的所有作品</p>
        </div>
        <div className="dashboard-actions">
          <button
            className="st-btn st-btn-primary"
            onClick={() => navigate("/workbench")}
          >
            <Plus size={16} />
            新建作品
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <BookOpen size={20} />
          <div className="stat-value">{books.length}</div>
          <div className="stat-label">总作品数</div>
        </div>
        <div className="stat-card">
          <Flame size={20} />
          <div className="stat-value">{books.filter((b) => b.status === "active").length}</div>
          <div className="stat-label">创作中</div>
        </div>
        <div className="stat-card">
          <CheckCircle2 size={20} />
          <div className="stat-value">{books.filter((b) => b.status === "completed").length}</div>
          <div className="stat-label">已完成</div>
        </div>
        <div className="stat-card">
          <BarChart2 size={20} />
          <div className="stat-value">{books.reduce((sum, b) => sum + (b.chaptersWritten ?? 0), 0)}</div>
          <div className="stat-label">总章节数</div>
        </div>
      </div>

      {/* Filters */}
      <div className="dashboard-filters">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索作品..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-tabs">
          <button
            className={statusFilter === "all" ? "is-active" : ""}
            onClick={() => setStatusFilter("all")}
          >
            全部
          </button>
          <button
            className={statusFilter === "in_progress" ? "is-active" : ""}
            onClick={() => setStatusFilter("in_progress")}
          >
            创作中
          </button>
          <button
            className={statusFilter === "completed" ? "is-active" : ""}
            onClick={() => setStatusFilter("completed")}
          >
            已完成
          </button>
        </div>
      </div>

      {/* Book List */}
      {loading ? (
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>加载中...</p>
        </div>
      ) : filteredBooks.length === 0 ? (
        <div className="dashboard-empty">
          <BookOpen size={48} />
          <h3>暂无作品</h3>
          <p>点击"新建作品"开始你的创作之旅</p>
        </div>
      ) : (
        <div className="book-grid">
          {filteredBooks.map((book) => (
            <div key={book.id} className="book-card" onClick={() => navigate(`/workbench/${book.id}`)}>
              <div className="book-card-header">
                <div className="book-status" style={{ color: statusColor(book.status) }}>
                  <span className="status-dot" style={{ backgroundColor: statusColor(book.status) }} />
                  {statusLabel(book.status)}
                </div>
                <div className="book-menu">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenu(activeMenu === book.id ? null : book.id);
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {activeMenu === book.id && (
                    <div className="menu-dropdown">
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/workbench/${book.id}`); }}>
                        <Settings size={14} /> 设置
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(book.id); }}>
                        <Trash2 size={14} /> 删除
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <h3 className="book-title">{book.title}</h3>
              <div className="book-meta">
                <span className="book-genre">{book.genre}</span>
                <span className="book-chapters">{book.chaptersWritten ?? 0} 章</span>
              </div>
              <div className="book-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, ((book.chaptersWritten ?? 0) / 30) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm Delete Dialog */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>确定要删除这部作品吗？此操作不可撤销。</p>
            <div className="modal-actions">
              <button className="st-btn" onClick={() => setConfirmDelete(null)}>取消</button>
              <button className="st-btn st-btn-danger" onClick={() => handleDelete(confirmDelete)}>删除</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dashboard {
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .dashboard-title h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
        }
        .dashboard-title p {
          margin: 4px 0 0;
          color: var(--text-dim);
          font-size: 14px;
        }
        .dashboard-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          text-align: center;
        }
        .stat-card svg {
          color: var(--primary);
          margin-bottom: 8px;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 700;
        }
        .stat-label {
          font-size: 12px;
          color: var(--text-dim);
          margin-top: 4px;
        }
        .dashboard-filters {
          display: flex;
          gap: 16px;
          margin-bottom: 24px;
          align-items: center;
        }
        .search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 12px;
          flex: 1;
        }
        .search-box input {
          border: none;
          background: none;
          outline: none;
          font-size: 14px;
          width: 100%;
        }
        .filter-tabs {
          display: flex;
          gap: 4px;
        }
        .filter-tabs button {
          padding: 6px 12px;
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        .filter-tabs button.is-active {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }
        .book-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        .book-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .book-card:hover {
          border-color: var(--primary);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .book-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .book-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .book-title {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 600;
        }
        .book-meta {
          display: flex;
          gap: 12px;
          font-size: 12px;
          color: var(--text-dim);
          margin-bottom: 12px;
        }
        .book-genre {
          background: var(--surface-alt);
          padding: 2px 8px;
          border-radius: 4px;
        }
        .progress-bar {
          height: 4px;
          background: var(--surface-alt);
          border-radius: 2px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: var(--primary);
          border-radius: 2px;
          transition: width 0.3s;
        }
        .dashboard-loading, .dashboard-empty {
          text-align: center;
          padding: 48px;
          color: var(--text-dim);
        }
        .dashboard-empty h3 {
          margin: 16px 0 8px;
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .modal {
          background: var(--surface);
          border-radius: 8px;
          padding: 24px;
          max-width: 400px;
          width: 90%;
        }
        .modal h3 {
          margin: 0 0 12px;
        }
        .modal-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 24px;
        }
        .menu-dropdown {
          position: absolute;
          right: 0;
          top: 100%;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 10;
          min-width: 120px;
        }
        .menu-dropdown button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 13px;
        }
        .menu-dropdown button:hover {
          background: var(--surface-alt);
        }
      `}</style>
    </div>
  );
}
