/**
 * TruthFilesPage —— 真相文件
 *
 * 功能：
 * 1. 查看书籍的世界观设定
 * 2. 管理角色设定
 * 3. 查看故事规则
 * 4. 编辑真相文件
 */

import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  FileText, BookOpen, Users, Scroll, Edit3, Save,
  Loader2,
} from "lucide-react";
import { fetchTruthFiles, updateTruthFile, type TruthFileData } from "../lib/api";

type TruthTab = "world" | "characters" | "rules" | "outline";

const TABS: ReadonlyArray<{ id: TruthTab; label: string; icon: typeof BookOpen }> = [
  { id: "world", label: "世界观", icon: BookOpen },
  { id: "characters", label: "角色", icon: Users },
  { id: "rules", label: "规则", icon: Scroll },
  { id: "outline", label: "大纲", icon: FileText },
];

export function TruthFilesPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const [activeTab, setActiveTab] = useState<TruthTab>("world");
  const [data, setData] = useState<TruthFileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const loadTruthFiles = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try {
      const result = await fetchTruthFiles(bookId);
      setData(result);
    } catch (err) {
      console.error("Failed to load truth files:", err);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    loadTruthFiles();
  }, [loadTruthFiles]);

  const handleSave = async () => {
    if (!bookId) return;
    setSaving(true);
    try {
      await updateTruthFile(bookId, activeTab, editContent);
      setData((prev => prev ? { ...prev, [activeTab]: editContent } : prev));
      setEditing(false);
    } catch (err) {
      console.error("Failed to save truth file:", err);
    } finally {
      setSaving(false);
    }
  };

  const currentContent = data?.[activeTab] ?? "";

  return (
    <div className="page">
      <header className="page-top">
        <h1 className="page-title">真相文件</h1>
        <nav className="page-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "is-on" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="page-body">
        {loading ? (
          <div className="page-loading">
            <Loader2 size={24} className="spin" />
            <p>加载中...</p>
          </div>
        ) : (
          <>
            <div className="truth-toolbar">
              <button
                className="st-btn st-btn-sm"
                onClick={() => {
                  setEditContent(currentContent);
                  setEditing(!editing);
                }}
              >
                <Edit3 size={14} />
                {editing ? "取消编辑" : "编辑"}
              </button>
              {editing && (
                <button
                  className="st-btn st-btn-sm st-btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                  {saving ? "保存中..." : "保存"}
                </button>
              )}
            </div>

            {editing ? (
              <textarea
                className="truth-editor"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={20}
              />
            ) : (
              <div className="truth-viewer">
                {currentContent ? (
                  <pre>{currentContent}</pre>
                ) : (
                  <div className="page-empty">暂无内容</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
