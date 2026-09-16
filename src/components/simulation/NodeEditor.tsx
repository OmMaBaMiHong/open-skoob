/**
 * NodeEditor —— 在全貌图里直接改一个节点（Phase 6.2d，老 studio workshop 的替代）。
 *
 * 范围是**玩家读到的那些字**：标题、场景描述、对白、选项文案。刻意不做的两件事：
 *   - 不改选项的去向、条件、effects —— 那是在改图的结构，得在校验器眼皮底下做，
 *     顺手改一下很容易把「攒够变量才解锁」那套设计改断；
 *   - 不删节点/选项 —— 播放器正踩在这张图上玩，脚下的路不能抽掉。
 * 这两件在老向导里也是要专门进编辑态才能做的，不是顺手操作。
 *
 * 提交走 delta 的 upsert（只发这一个节点），不整图覆盖。
 */
import { useState } from "react";
import { Loader2, Check, X, ImagePlus } from "lucide-react";
import { upsertFilmNode, generateFilmNodeImage, fetchStoryGraph } from "../../lib/api";
import type { StoryNode, StoryGraph } from "../../lib/story-play";

interface NodeEditorProps {
  readonly projectId: string;
  readonly node: StoryNode;
  readonly onSaved: (graph: StoryGraph) => void;
  readonly onCancel: () => void;
}

export function NodeEditor({ projectId, node, onSaved, onCancel }: NodeEditorProps) {
  const [title, setTitle] = useState(node.title);
  const [scene, setScene] = useState(node.sceneDesc);
  const [lines, setLines] = useState(node.dialogue.map((l) => ({ ...l })));
  const [choices, setChoices] = useState(node.choices.map((c) => ({ id: c.id, text: c.text })));
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 生成配图。后端自己把 assetRef 写回图里，所以这里重新取一份整图交回去。 */
  const draw = async () => {
    setDrawing(true);
    setError(null);
    try {
      await generateFilmNodeImage(projectId, node.id);
      onSaved(await fetchStoryGraph(projectId) as StoryGraph);
    } catch (e) {
      setError((e as Error).message || "生成配图失败");
    } finally {
      setDrawing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      /* 从原节点整份改出来 —— 只覆盖编辑过的字段，condition/effects/weight/
         targetNodeId 原样带回去，不能因为表单里没有就丢掉。 */
      const next = {
        ...node,
        title,
        sceneDesc: scene,
        dialogue: lines,
        choices: node.choices.map((c) => ({
          ...c,
          text: choices.find((x) => x.id === c.id)?.text ?? c.text,
        })),
      };
      const graph = await upsertFilmNode(projectId, next) as StoryGraph;
      onSaved(graph);
    } catch (e) {
      setError((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node-edit">
      <label className="node-edit-row">
        <span>标题</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="node-edit-row">
        <span>场景</span>
        <textarea rows={2} value={scene} onChange={(e) => setScene(e.target.value)} />
      </label>

      {lines.length > 0 && <div className="node-edit-head">对白</div>}
      {lines.map((line, i) => (
        <div key={i} className="node-edit-line">
          <input
            className="node-edit-speaker"
            value={line.speaker}
            placeholder="谁说的"
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, speaker: e.target.value } : l)))}
          />
          <textarea
            rows={2}
            value={line.text}
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))}
          />
        </div>
      ))}

      {choices.length > 0 && <div className="node-edit-head">选项文案</div>}
      {choices.map((c, i) => (
        <input
          key={c.id}
          value={c.text}
          onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
        />
      ))}

      {error && <p className="node-edit-err">{error}</p>}
      <div className="node-edit-actions">
        <button type="button" className="node-edit-save" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={11} className="spin" /> : <Check size={11} />} 保存
        </button>
        <button type="button" onClick={draw} disabled={saving || drawing}>
          {drawing ? <Loader2 size={11} className="spin" /> : <ImagePlus size={11} />}
          {node.imageSlot?.assetRef ? "重画配图" : "生成配图"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving || drawing}><X size={11} /> 取消</button>
      </div>
    </div>
  );
}
