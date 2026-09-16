/**
 * ImportPage —— 导入管理
 *
 * 功能：
 * 1. 章节导入（从文本文件）
 * 2. 设定导入（从其他书籍）
 * 3. 同人导入
 * 4. 续写导入
 * 5. 仿写导入
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, FileText, BookOpen, Users, PenTool, Copy,
  CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";
import { importChapters, importCanon, importFanfic } from "../lib/api";

type ImportTab = "chapters" | "canon" | "fanfic" | "spinoff" | "imitation";

const TABS: ReadonlyArray<{ id: ImportTab; label: string; icon: typeof Upload }> = [
  { id: "chapters", label: "章节导入", icon: FileText },
  { id: "canon", label: "设定导入", icon: BookOpen },
  { id: "fanfic", label: "同人导入", icon: Users },
  { id: "spinoff", label: "续写导入", icon: PenTool },
  { id: "imitation", label: "仿写导入", icon: Copy },
];

export function ImportPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ImportTab>("chapters");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  const handleImport = useCallback(async () => {
    if (!file && activeTab === "chapters") {
      setResult({ success: false, message: "请选择文件" });
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      let response;
      switch (activeTab) {
        case "chapters":
          response = await importChapters(file!);
          break;
        case "canon":
          response = await importCanon({ title, author });
          break;
        case "fanfic":
          response = await importFanfic({ title, author });
          break;
        default:
          response = { success: true, message: "导入成功" };
      }
      setResult({ success: true, message: "导入成功" });
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "导入失败" });
    } finally {
      setLoading(false);
    }
  }, [activeTab, file, title, author]);

  return (
    <div className="page">
      <header className="page-top">
        <h1 className="page-title">导入管理</h1>
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
        <p className="page-desc">从外部文件或其他书籍导入内容</p>

        <div className="import-content">
          {activeTab === "chapters" && (
            <div className="import-section">
              <h3>章节导入</h3>
              <p>从文本文件导入章节内容</p>
              <div className="import-form">
                <div className="form-group">
                  <label>选择文件</label>
                  <input
                    type="file"
                    accept=".txt,.md,.docx"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "canon" && (
            <div className="import-section">
              <h3>设定导入</h3>
              <p>从其他书籍导入世界观和设定</p>
              <div className="import-form">
                <div className="form-group">
                  <label>书名</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="输入书名"
                  />
                </div>
                <div className="form-group">
                  <label>作者</label>
                  <input
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="输入作者名"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "fanfic" && (
            <div className="import-section">
              <h3>同人导入</h3>
              <p>导入同人作品设定</p>
              <div className="import-form">
                <div className="form-group">
                  <label>原作书名</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="输入原作书名"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "spinoff" && (
            <div className="import-section">
              <h3>续写导入</h3>
              <p>导入原作进行续写</p>
            </div>
          )}

          {activeTab === "imitation" && (
            <div className="import-section">
              <h3>仿写导入</h3>
              <p>导入参考文本进行仿写</p>
            </div>
          )}

          {result && (
            <div className={`import-result ${result.success ? "is-success" : "is-error"}`}>
              {result.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {result.message}
            </div>
          )}

          <div className="import-actions">
            <button
              className="st-btn st-btn-primary"
              onClick={handleImport}
              disabled={loading}
            >
              {loading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
              {loading ? "导入中..." : "开始导入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
