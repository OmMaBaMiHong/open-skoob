/**
 * 封面编辑器 —— 显示 / 上传 / 生成 / 删除。
 *
 * 书和模板资产共用一个组件，因为对用户是同一件事（"这个东西长什么样"），
 * 后端也是同一套接口。
 *
 * 封面按 **3:4 竖版**（书封比例）存与展示。列表卡片里是 16:9 的槽位、取中间
 * 一段，完整的竖版只在这里看得到——所以这里必须按真实比例显示，否则用户
 * 传完不知道自己传的是什么样。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Sparkles, Trash2, Loader2, AlertCircle } from "lucide-react";
import {
  fetchCover, uploadCover, generateCover, deleteCover,
  type CoverKind,
} from "../lib/api";

import { CoverStudio } from "./CoverStudio";

interface CoverEditorProps {
  readonly kind: CoverKind;
  readonly id: string;
  /** 没有封面时占位用的标题。 */
  readonly title: string;
}

export function CoverEditor(props: CoverEditorProps) {
  return props.kind === "book" ? <CoverStudio initialBookId={props.id} embedded /> : <LegacyCoverEditor {...props} />;
}

function LegacyCoverEditor({ kind, id, title }: CoverEditorProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "upload" | "generate" | "delete">("");
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void fetchCover(kind, id).then((c) => { if (live) setUrl(c.url); });
    return () => { live = false; };
  }, [kind, id]);

  const run = useCallback(async (
    job: "upload" | "generate" | "delete",
    fn: () => Promise<string | null>,
  ) => {
    setBusy(job);
    setError(null);
    try {
      setUrl(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy("");
    }
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 选完就清掉 value：不清的话选同一个文件第二次不会触发 change。
    e.target.value = "";
    if (!file) return;
    void run("upload", async () => (await uploadCover(kind, id, file)).url);
  };

  return (
    <section className="cv">
      <div className="cv-frame">
        {url
          ? <img className="cv-img" src={url} alt={`${title} 封面`} />
          : <div className="cv-empty"><span>{title}</span><em>还没有封面</em></div>}
        {busy && (
          <div className="cv-mask">
            <Loader2 size={18} className="spin" />
            {busy === "generate" ? "正在生成…" : busy === "upload" ? "上传中…" : "删除中…"}
          </div>
        )}
      </div>

      <div className="cv-side">
        <p className="cv-hint">建议 3:4 竖版，JPG / PNG / WebP，单张不超过 5MB。</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={onPick}
        />
        <button className="cv-btn" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={13} /> 上传封面
        </button>

        <div className="cv-gen">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="想要什么画面？留空则按书名自动生成"
            disabled={Boolean(busy)}
          />
          <button
            className="cv-btn is-primary"
            disabled={Boolean(busy)}
            onClick={() => void run("generate", async () => (await generateCover(kind, id, prompt)).url)}
          >
            <Sparkles size={13} /> 生成封面
          </button>
        </div>

        {url && (
          <button
            className="cv-btn is-danger"
            disabled={Boolean(busy)}
            onClick={() => void run("delete", async () => { await deleteCover(kind, id); return null; })}
          >
            <Trash2 size={13} /> 删除封面
          </button>
        )}

        {error && <div className="cv-err"><AlertCircle size={13} /> {error}</div>}
      </div>
    </section>
  );
}
