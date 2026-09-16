/**
 * CreateGroupDialog —— 拉角色建群。
 *
 * 用户不必等仿真开场：选几个角色就能开一场戏。群名留空时按当前
 * 模拟的章节/步骤自动命名（和自动建的群同一套语义，见 lib/sim-theater.ts）。
 */
import { useState, useMemo } from "react";
import { X, Search, Check } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { hueOf, shortName } from "../../lib/sim-theater";
import type { GraphAgent } from "../../lib/api";

interface CreateGroupDialogProps {
  readonly agents: ReadonlyArray<GraphAgent>;
  readonly extraNames: ReadonlyArray<string>;
  /** 自动命名的预览（群名留空时用它）。 */
  readonly namePreview: string;
  readonly onClose: () => void;
  readonly onCreate: (memberNames: ReadonlyArray<string>, title?: string) => void;
}

export function CreateGroupDialog({
  agents, extraNames, namePreview, onClose, onCreate,
}: CreateGroupDialogProps) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [title, setTitle] = useState("");

  const list = useMemo(() => {
    const all = [
      ...agents.map((a) => ({ id: a.name, desc: a.bio || a.persona || "", type: a.agentType })),
      ...extraNames.map((n) => ({ id: n, desc: "（画像待生成）", type: "" })),
    ];
    const kw = q.trim().toLowerCase();
    if (!kw) return all;
    return all.filter((a) => a.id.toLowerCase().includes(kw) || a.desc.toLowerCase().includes(kw));
  }, [agents, extraNames, q]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = () => {
    if (picked.length === 0) return;
    onCreate(picked, title.trim() || undefined);
    onClose();
  };

  return (
    <div className="sim-dialog-mask" onClick={onClose}>
      <div className="sim-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="sim-dialog-head">
          <h3>拉角色建群</h3>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>

        <div className="sim-dialog-field">
          <Search size={12} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜角色…" />
        </div>

        <div className="sim-dialog-field">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`群名（留空 → ${namePreview}）`}
          />
        </div>

        <div className="sim-dialog-list">
          {list.length === 0 ? (
            <p className="sim-sidebar-empty">没有匹配的角色。</p>
          ) : (
            list.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`sim-dialog-item${on ? " is-on" : ""}`}
                  onClick={() => toggle(a.id)}
                >
                  <AgentAvatar
                    name={shortName(a.id)}
                    hue={hueOf(a.id)}
                    agentType={a.type || undefined}
                    size="sm"
                  />
                  <span className="sim-dialog-item-body">
                    <span className="sim-dialog-item-name">{shortName(a.id)}</span>
                    <span className="sim-dialog-item-desc">{a.desc || "（暂无简介）"}</span>
                  </span>
                  {on && <Check size={13} />}
                </button>
              );
            })
          )}
        </div>

        <footer className="sim-dialog-foot">
          <span>
            已选 {picked.length} 人
            {picked.length === 1 && "（一个人 = 私聊）"}
          </span>
          <div>
            <button type="button" className="sim-dialog-cancel" onClick={onClose}>取消</button>
            <button type="button" className="sim-dialog-ok" disabled={picked.length === 0} onClick={create}>
              开一场
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
