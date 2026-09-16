/**
 * ChoicePointPanel —— 剧情决策点。
 *
 * 这是仿真剧场和**互动影游**接上的地方，但决策点不是编出来的：
 * 六步编排跑到闸门（`awaiting_review`）时就是一个真实的分叉——
 *   通过  → 这一步定稿，剧情按推演结果往下走；
 *   重铸  → 带着你的反馈重跑这一步，后续剧情随之改写。
 * 和互动影游的 Choice 一样是「选项 → effects → 走向另一条路」，
 * 只是这里的 effect 作用在真正的创作链上，不是一张分支图上的变量。
 */
import { useState } from "react";
import { GitBranch, Check, RotateCcw, X } from "lucide-react";
import type { TheaterGate } from "../../hooks/use-simulation-theater";

interface ChoicePointPanelProps {
  readonly gate: TheaterGate | null;
  readonly busy: boolean;
  readonly onDecide: (decision: "confirm" | "reject", feedback?: string) => void;
}

export function ChoicePointPanel({ gate, busy, onDecide }: ChoicePointPanelProps) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!gate) return null;

  return (
    <div className="sim-gate">
      <div className="sim-gate-head">
        <GitBranch size={12} />
        剧情决策点 · {gate.stepLabel}
        {gate.chapter !== null && ` · 第 ${gate.chapter} 章`}
      </div>

      {!rejecting ? (
        <>
          <p className="sim-gate-text">
            这一步的推演结果已经出来了。定了就照这条线往下写；不满意可以带上你的意见重推，
            后续剧情跟着改。
          </p>
          <div className="sim-gate-actions">
            <button type="button" className="sim-gate-ok" disabled={busy} onClick={() => onDecide("confirm")}>
              <Check size={12} /> 就这么走
            </button>
            <button type="button" className="sim-gate-redo" disabled={busy} onClick={() => setRejecting(true)}>
              <RotateCcw size={12} /> 换个走向
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            className="sim-gate-input"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="想怎么改？例如：这一场冲突太快了，先让两人各退一步，把矛盾压到下一章再爆。"
            rows={3}
          />
          <div className="sim-gate-actions">
            <button
              type="button"
              className="sim-gate-ok"
              disabled={busy || !feedback.trim()}
              onClick={() => { onDecide("reject", feedback.trim()); setRejecting(false); setFeedback(""); }}
            >
              <RotateCcw size={12} /> 按这个重推
            </button>
            <button type="button" className="sim-gate-redo" onClick={() => setRejecting(false)}>
              <X size={12} /> 取消
            </button>
          </div>
        </>
      )}
    </div>
  );
}
