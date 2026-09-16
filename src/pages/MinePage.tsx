/**
 * 「我的」—— 底栏第五个标签落到的那一页。
 *
 * ── 为什么要有这一页 ──
 *
 * 原来 `/settings` 直接重定向到「模型配置」：点「我的」，迎面是一屏 API Key
 * 和服务商列表。那是**设置里最深的一层**，不是个人中心该有的样子——用户在这里
 * 想知道的是「我是谁、会员到什么时候」，以及「去哪」。
 *
 * 所以这一页只做两件事：亮明身份，然后把去处列清楚。具体的配置各自是子页。
 *
 * ── 极简 ──
 *
 * 不写说明文字。每一行就是一个去处，名字本身说明了它是什么；真要解释的东西
 * 放进那一页里，而不是堆在入口上。
 */
import { Link, useNavigate } from "react-router-dom";
import {
  Plug, Route as RouteIcon, User, ShieldCheck, Upload, Globe, Radar,
  Crown, LogOut, Sun, Moon, ChevronRight,
} from "lucide-react";
import { useMembership } from "../hooks/use-membership";
import { useTheme } from "../hooks/use-theme";
import { useI18n } from "../i18n";
import { logout, startOAuthLogin } from "../lib/account";

interface Entry {
  readonly to: string;
  readonly label: string;
  readonly Icon: typeof Plug;
}

/** 分组之间空一行就够，不加小标题——三组的意思一眼看得出来。 */
const GROUPS: ReadonlyArray<ReadonlyArray<Entry>> = [
  [
    { to: "/settings/models", label: "模型配置", Icon: Plug },
    { to: "/settings/routing", label: "模型路由", Icon: RouteIcon },
    { to: "/settings/account", label: "账号与会员", Icon: User },
  ],
  /*
   * 没进底栏的那几个。
   *
   * 底栏放的是日常反复进出的五个（创作/作品库/拆书/智能体/我的）；这三个是
   * 偶尔用一次的工具，摆进底栏会把每个标签挤到点不准。但它们**不能因此消失**
   * ——手机上除了这里没有别的入口了。
   */
  [
    { to: "/deai", label: "天工AI检测", Icon: ShieldCheck },
    { to: "/scan", label: "扫榜", Icon: Radar },
    { to: "/import", label: "导入管理", Icon: Upload },
    { to: "/site", label: "官网", Icon: Globe },
  ],
];

export function MinePage() {
  const membership = useMembership();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const navigate = useNavigate();

  /*
   * 登录与否看 `loggedIn`，不看有没有名字。
   *
   * app_user 里的 username/email 可能是空串（sub2api 同步时没带回来），
   * 拿它判断会把「登录了但没名字」显示成「未登录」——同时下面又标着会员，
   * 自相矛盾。名字取不到就用一个中性称呼，别拿它当登录状态使。
   */
  const displayName = membership.user?.username || membership.user?.email || "";
  const name = membership.loggedIn ? (displayName || "我的账号") : "未登录";

  const onLogout = async () => {
    await logout().catch(() => undefined);
    await membership.refresh();
    navigate("/create");
  };

  return (
    <div className="page mine">
      {/*
        身份卡。会员状态用一个角标表示，不写整句话——
        「会员 · 到 2026-10-01」比「您当前是会员，有效期至…」好读得多。
      */}
      <section className="mine-id">
        <div className="mine-avatar">{membership.loggedIn ? (displayName.slice(0, 1) || "我").toUpperCase() : "?"}</div>
        <div className="mine-id-text">
          <div className="mine-name">{name}</div>
          <div className="mine-sub">
            {membership.loading
              ? "…"
              : !membership.loggedIn
                // 没登录就不谈会员——那是登录之后才有的事。
                ? <button type="button" className="mine-upsell" onClick={() => startOAuthLogin(window.location.href)}>
                    授权登录
                  </button>
                : membership.isMember
                  ? <span className="mine-vip"><Crown size={11} />{membership.plan || "会员"}</span>
                  : <Link to="/pricing" className="mine-upsell">开通会员</Link>}
          </div>
        </div>
      </section>

      {GROUPS.map((group, i) => (
        <nav className="mine-list" key={i}>
          {group.map(({ to, label, Icon }) => (
            <Link to={to} className="mine-item" key={to}>
              <Icon size={17} />
              <span>{label}</span>
              <ChevronRight size={15} className="mine-arrow" />
            </Link>
          ))}
        </nav>
      ))}

      <nav className="mine-list">
        <button type="button" className="mine-item" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme === "dark" ? t("layout.theme_to_light") : t("layout.theme_to_dark")}</span>
        </button>
        {membership.loggedIn && (
          <button type="button" className="mine-item is-danger" onClick={() => void onLogout()}>
            <LogOut size={17} />
            <span>{t("layout.logout")}</span>
          </button>
        )}
      </nav>
    </div>
  );
}
