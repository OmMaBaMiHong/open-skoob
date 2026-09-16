/**
 * StyleManager — 风格管理面板
 *
 * 功能：
 * 1. 从参考文本提取风格
 * 2. 管理风格库
 * 3. 绑定风格到书籍
 * 4. 查看风格详情
 */

import { useState, useCallback } from "react";
import { Plus, Trash2, Palette, BookOpen, BarChart3 } from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

interface StyleFingerprint {
  id: string;
  name: string;
  description: string;
  profile: {
    avgSentenceLength: number;
    avgParagraphLength: number;
    vocabularyDiversity: number;
    rhetoricalFeatures: string[];
    topPatterns: string[];
  };
  createdAt: string;
  language: "zh" | "en";
}

interface StyleManagerProps {
  bookId?: string;
  onStyleBind?: (styleId: string) => void;
}

// ============================================================================
// 组件
// ============================================================================

export function StyleManager({ bookId, onStyleBind }: StyleManagerProps) {
  const [styles, setStyles] = useState<StyleFingerprint[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newStyle, setNewStyle] = useState({ name: "", description: "", sampleText: "" });
  const [extracting, setExtracting] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  // 创建风格
  const handleCreateStyle = useCallback(() => {
    if (!newStyle.name.trim() || !newStyle.sampleText.trim()) return;
    setExtracting(true);

    // 模拟风格提取
    setTimeout(() => {
      const style: StyleFingerprint = {
        id: `style_${Date.now()}`,
        name: newStyle.name,
        description: newStyle.description,
        profile: {
          avgSentenceLength: 18.5,
          avgParagraphLength: 120,
          vocabularyDiversity: 0.72,
          rhetoricalFeatures: ["短句节奏(3)", "比喻(2)"],
          topPatterns: ["他...(4次)", "她...(3次)"],
        },
        createdAt: new Date().toISOString(),
        language: "zh",
      };
      setStyles((prev) => [...prev, style]);
      setNewStyle({ name: "", description: "", sampleText: "" });
      setShowCreate(false);
      setExtracting(false);
    }, 800);
  }, [newStyle]);

  // 删除风格
  const handleDeleteStyle = useCallback((id: string) => {
    setStyles((prev) => prev.filter((s) => s.id !== id));
    if (selectedStyle === id) setSelectedStyle(null);
  }, [selectedStyle]);

  // 绑定风格
  const handleBindStyle = useCallback((styleId: string) => {
    onStyleBind?.(styleId);
  }, [onStyleBind]);

  const selected = styles.find((s) => s.id === selectedStyle);

  return (
    <div className="style-manager">
      <div className="style-header">
        <h3>
          <Palette size={16} />
          风格管理
        </h3>
        <button className="st-btn st-btn-sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} />
          提取风格
        </button>
      </div>

      {/* 创建风格表单 */}
      {showCreate && (
        <div className="style-create">
          <input
            type="text"
            placeholder="风格名称"
            value={newStyle.name}
            onChange={(e) => setNewStyle((p) => ({ ...p, name: e.target.value }))}
            className="st-input"
          />
          <input
            type="text"
            placeholder="风格描述（可选）"
            value={newStyle.description}
            onChange={(e) => setNewStyle((p) => ({ ...p, description: e.target.value }))}
            className="st-input"
          />
          <textarea
            placeholder="粘贴参考文本（至少 200 字）"
            value={newStyle.sampleText}
            onChange={(e) => setNewStyle((p) => ({ ...p, sampleText: e.target.value }))}
            className="st-textarea"
            rows={6}
          />
          <div className="style-create-actions">
            <button className="st-btn st-btn-sm" onClick={() => setShowCreate(false)}>
              取消
            </button>
            <button
              className="st-btn st-btn-sm st-btn-primary"
              onClick={handleCreateStyle}
              disabled={extracting || !newStyle.name.trim() || !newStyle.sampleText.trim()}
            >
              {extracting ? "提取中..." : "提取风格"}
            </button>
          </div>
        </div>
      )}

      {/* 风格列表 */}
      <div className="style-list">
        {styles.length === 0 ? (
          <div className="style-empty">暂无风格，点击"提取风格"创建</div>
        ) : (
          styles.map((style) => (
            <div
              key={style.id}
              className={`style-item ${selectedStyle === style.id ? "is-selected" : ""}`}
              onClick={() => setSelectedStyle(style.id)}
            >
              <div className="style-item-header">
                <span className="style-item-name">{style.name}</span>
                <div className="style-item-actions">
                  {bookId && (
                    <button
                      className="st-btn st-btn-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBindStyle(style.id);
                      }}
                      title="绑定到当前书籍"
                    >
                      <BookOpen size={12} />
                    </button>
                  )}
                  <button
                    className="st-btn st-btn-xs st-btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteStyle(style.id);
                    }}
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="style-item-meta">
                <span>句长 {style.profile.avgSentenceLength}</span>
                <span>段落 {style.profile.avgParagraphLength}</span>
                <span>词汇 {Math.round(style.profile.vocabularyDiversity * 100)}%</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 风格详情 */}
      {selected && (
        <div className="style-detail">
          <h4>
            <BarChart3 size={14} />
            {selected.name} — 风格详情
          </h4>
          <div className="style-profile">
            <div className="style-profile-item">
              <span className="style-profile-label">平均句长</span>
              <span className="style-profile-value">{selected.profile.avgSentenceLength} 字</span>
            </div>
            <div className="style-profile-item">
              <span className="style-profile-label">平均段落</span>
              <span className="style-profile-value">{selected.profile.avgParagraphLength} 字</span>
            </div>
            <div className="style-profile-item">
              <span className="style-profile-label">词汇多样性</span>
              <span className="style-profile-value">{Math.round(selected.profile.vocabularyDiversity * 100)}%</span>
            </div>
            {selected.profile.rhetoricalFeatures.length > 0 && (
              <div className="style-profile-item">
                <span className="style-profile-label">修辞特征</span>
                <span className="style-profile-value">{selected.profile.rhetoricalFeatures.join(", ")}</span>
              </div>
            )}
            {selected.profile.topPatterns.length > 0 && (
              <div className="style-profile-item">
                <span className="style-profile-label">常见句式</span>
                <span className="style-profile-value">{selected.profile.topPatterns.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .style-manager {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          background: var(--surface);
        }
        .style-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .style-header h3 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          font-size: 14px;
          font-weight: 600;
        }
        .style-create {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: var(--surface-alt);
          border-radius: 6px;
          margin-bottom: 16px;
        }
        .style-create-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .style-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 300px;
          overflow-y: auto;
        }
        .style-empty {
          text-align: center;
          color: var(--text-dim);
          font-size: 13px;
          padding: 20px;
        }
        .style-item {
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .style-item:hover {
          border-color: var(--primary);
        }
        .style-item.is-selected {
          border-color: var(--primary);
          background: var(--primary-bg);
        }
        .style-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .style-item-name {
          font-weight: 500;
          font-size: 13px;
        }
        .style-item-actions {
          display: flex;
          gap: 4px;
        }
        .style-item-meta {
          display: flex;
          gap: 12px;
          font-size: 11px;
          color: var(--text-dim);
        }
        .style-detail {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .style-detail h4 {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0 0 12px;
          font-size: 13px;
          font-weight: 600;
        }
        .style-profile {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        .style-profile-item {
          display: flex;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--surface-alt);
          border-radius: 4px;
          font-size: 12px;
        }
        .style-profile-label {
          color: var(--text-dim);
        }
        .style-profile-value {
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
