/**
 * ServiceQuickLinks — 「去哪申请 key」的入口。
 *
 * 老前端的表里全是已下线的 provider（kkaiapi / openrouter / moonshot…），
 * 唯独没有 gaotk —— 而 2026-08-27 的改动把内置 provider 砍到只剩
 * GAOTK + CUSTOM，所以官方入口反而是最该有链接的那个。这里以 gaotk 为主。
 */
import { ExternalLink } from "lucide-react";

interface QuickLink {
  readonly label: string;
  readonly path: string;
  readonly primary?: boolean;
}

/**
 * 服务商 → 快捷入口。
 * path 为相对路径时拼中转站地址（账号配置里的 sub2apiUrl），
 * 绝对地址则原样打开。
 */
const LINKS: Readonly<Record<string, ReadonlyArray<QuickLink>>> = {
  gaotk: [
    { label: "领取 API Key", path: "token", primary: true },
    { label: "兑换 / 充值", path: "redeem" },
    { label: "套餐", path: "purchase" },
  ],
};

export function getServiceQuickLinks(serviceId: string): ReadonlyArray<QuickLink> {
  return LINKS[serviceId] ?? [];
}

export function ServiceQuickLinks({
  serviceId,
  siteUrl,
}: {
  readonly serviceId: string;
  /** 中转站地址（/api/v1/account/status 的 sub2apiUrl）。 */
  readonly siteUrl: string | null;
}) {
  const links = getServiceQuickLinks(serviceId);
  if (links.length === 0) return null;
  const base = (siteUrl || "https://gaotk.com").replace(/\/$/, "");

  return (
    <div className="sql">
      <span className="sql-label">配置入口</span>
      {links.map((l) => (
        <a
          key={l.path}
          href={/^https?:\/\//.test(l.path) ? l.path : `${base}/${l.path}`}
          target="_blank"
          rel="noreferrer"
          className={`sql-link ${l.primary ? "is-primary" : ""}`}
        >
          {l.label}
          <ExternalLink size={11} />
        </a>
      ))}
    </div>
  );
}
