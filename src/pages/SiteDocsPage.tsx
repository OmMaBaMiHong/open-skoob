/**
 * 文档中心（/site/docs、/site/docs/:docId）—— 从老前端 DocumentationPage 移植。
 *
 * 适配点：
 * - 路由从 hash（#/documentation、#/api-docs…）改为 react-router：
 *   /site/docs 默认产品手册，/site/docs/:docId 直达某篇；
 * - 「返回首页」改为返回 /site（v2 的官网首页）；
 * - 主题切换接 v2 全局 useTheme；
 * - markdown 源文件在 public/docs/<docId>/index.md，marked 渲染 + 标题锚点目录。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { ArrowLeft, BookOpen, Compass, FileCode2, Loader2, Moon, ScrollText, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { IcpNotice } from "../components/IcpNotice";

/* ------------------------------------------------------------------ */
/* 文档注册表：与 public/docs/ 下的 markdown 一一对应                   */
/* ------------------------------------------------------------------ */

type DocId = "product-manual" | "user-guide" | "api" | "api-integration";

const DOCS: Record<
  DocId,
  { readonly title: string; readonly en: string; readonly desc: string; readonly path: string; readonly Icon: typeof BookOpen }
> = {
  "product-manual": {
    title: "产品手册",
    en: "Product Manual",
    desc: "Skoob 是什么 · 小说知识库 · 引擎分工 · 六步创作",
    path: "/docs/product-manual/index.md",
    Icon: Compass,
  },
  "user-guide": {
    title: "用户指南",
    en: "User Guide",
    desc: "从零开始创作 · 引擎使用 · 章节写作 · 会员权益",
    path: "/docs/user-guide/index.md",
    Icon: BookOpen,
  },
  api: {
    title: "能力与计费",
    en: "Engine API",
    desc: "四大引擎 · 七项 API 能力 · 套餐与计量",
    path: "/docs/api/index.md",
    Icon: FileCode2,
  },
  "api-integration": {
    title: "接入指南",
    en: "Integration Guide",
    desc: "服务域名 · API Key · 调用准备 · 联调与结算",
    path: "/docs/api-integration/index.md",
    Icon: FileCode2,
  },
};

const DOC_GROUPS: ReadonlyArray<{ label: string; ids: ReadonlyArray<DocId> }> = [
  { label: "创作者文档", ids: ["product-manual", "user-guide"] },
  { label: "开发者文档", ids: ["api", "api-integration"] },
];

function isDocId(value: string | undefined): value is DocId {
  return value === "product-manual" || value === "user-guide" || value === "api" || value === "api-integration";
}

/* ------------------------------------------------------------------ */
/* Markdown：给标题生成稳定 id，供「本页目录」锚点跳转                    */
/* ------------------------------------------------------------------ */

function stripMd(text: string): string {
  return text.replace(/[*_`~[\]()]/g, "").trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

marked.use({
  renderer: {
    heading({ text, depth }: { text: string; depth: number }) {
      const id = slugify(stripMd(text));
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    },
  },
});

interface TocItem {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}

function extractToc(md: string): TocItem[] {
  return md.split("\n").flatMap((line) => {
    const m = line.match(/^(#{2,3})\s+(.+)/);
    if (!m) return [];
    const text = stripMd(m[2]);
    return [{ level: m[1].length, text, id: slugify(text) }];
  });
}

/* ------------------------------------------------------------------ */
/* 文档中心页面                                                        */
/* ------------------------------------------------------------------ */

export function SiteDocsPage() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const params = useParams<{ docId?: string }>();
  const active: DocId = isDocId(params.docId) ? params.docId : "product-manual";
  const [html, setHtml] = useState<string>("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = await fetch(DOCS[active].path);
        if (!res.ok) throw new Error(`加载失败 HTTP ${res.status}`);
        const md = await res.text();
        if (cancelled) return;
        setToc(extractToc(md));
        const rendered = await marked.parse(md, { gfm: true, breaks: false });
        setHtml(active === "api" || active === "api-integration"
          ? rendered.replace(/<table>/g, '<div class="skd-table-scroll" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>').replace(/<\/table>/g, "</table></div>")
          : rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [active, reloadKey]);

  const goToDoc = useCallback(
    (id: DocId) => {
      navigate(`/site/docs/${id}`);
    },
    [navigate],
  );

  const scrollToHeading = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const meta = DOCS[active];

  return (
    <div className={`skd-root ${isDark ? "skd-dark" : "skd-light"}`}>
      {/* 顶栏 */}
      <header className="skd-topbar">
        <div className="skd-topbar-inner">
          <Link to="/site" className="skd-back">
            <ArrowLeft size={15} /> 返回首页
          </Link>
          <div className="skd-topbar-title">
            <ScrollText size={17} />
            <strong>文档中心</strong>
            <span>/ {meta.title}</span>
          </div>
          <button type="button" className="skd-topbar-link" onClick={toggleTheme} title={isDark ? "切换浅色主题" : "切换深色主题"}>
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
            <span>{isDark ? "浅色" : "深色"}</span>
          </button>
        </div>
      </header>

      <div className="skd-body">
        {/* 侧栏：文档 + 本页目录 */}
        <aside className="skd-side">
          {DOC_GROUPS.map(group => <div className="skd-side-sec" key={group.label}>
            <span className="skd-side-label">{group.label}</span>
            <nav className="skd-doc-list" aria-label={group.label}>
              {group.ids.map((id) => {
                const d = DOCS[id];
                const activeItem = id === active;
                return (
                  <button
                    key={id}
                    type="button"
                    className={activeItem ? "is-active" : ""}
                    onClick={() => goToDoc(id)}
                    aria-current={activeItem ? "page" : undefined}
                  >
                    <d.Icon size={15} />
                    <span>
                      <strong>{d.title}</strong>
                      <small>{d.en}</small>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>)}

          {toc.length > 0 && (
            <div className="skd-side-sec skd-toc-sec">
              <span className="skd-side-label">本页目录</span>
              <nav className="skd-toc">
                {toc.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.level === 2 ? "lvl-2" : "lvl-3"}
                    onClick={() => scrollToHeading(item.id)}
                  >
                    {item.level === 3 && <span className="skd-toc-dot" />}
                    {item.text}
                  </button>
                ))}
              </nav>
            </div>
          )}
        </aside>

        {/* 正文 */}
        <main className="skd-content">
          <div className="skd-content-card">
            {loading ? (
              <div className="skd-loading">
                <Loader2 size={22} className="skd-spin" />
                <span>正在加载文档…</span>
              </div>
            ) : error ? (
              <div className="skd-error">
                <strong>文档加载失败</strong>
                <p>{error}</p>
                <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
                  重试
                </button>
              </div>
            ) : (
              <article className="doc-md" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
          <footer className="skd-content-foot">
            <span>© 2026 Skoob · 焚诀（Burn Art）文档中心</span>
            <IcpNotice />
          </footer>
        </main>
      </div>
    </div>
  );
}
