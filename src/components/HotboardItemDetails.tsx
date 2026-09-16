import type { HotboardItem } from "../lib/api";

/** 保留来源的指标口径，两处榜单使用同一套展示字段。 */
export function hotboardItemDetails(item: HotboardItem): string[] {
  const meta: Readonly<Record<string, unknown>> = item.meta ?? {};
  const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  const category = text(meta.category);
  const author = text(meta.author);
  const metric = text(item.heatLabel) || text(meta.metricLabel);
  const wordCount = text(meta.wordCount).replace(/字+$/u, "字");
  const status = text(meta.status);
  const tags = (Array.isArray(meta.tags) ? meta.tags.map(text) : text(meta.tags).split(/[,，、]/u))
    .filter((tag) => tag && !category.split(/[,，、·]/u).includes(tag));
  return [
    category && `分类：${category}`,
    author && `作者：${author}`,
    wordCount && !metric.includes(wordCount) ? wordCount : "",
    metric || (typeof item.heat === "number" && Number.isFinite(item.heat) ? `热度 ${item.heat.toLocaleString("zh-CN")}` : ""),
    status && !/^\d+$/u.test(status) ? status : "",
    tags.length ? `标签：${[...new Set(tags)].join("、")}` : "",
    text(meta.update),
  ].filter(Boolean);
}

export function HotboardItemDetails({ item }: { readonly item: HotboardItem }) {
  const details = hotboardItemDetails(item);
  return details.length ? <span className="hb-item-details">{details.map((detail, index) => <span key={index}>{detail}</span>)}</span> : null;
}
