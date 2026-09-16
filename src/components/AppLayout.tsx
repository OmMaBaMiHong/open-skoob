/**
 * 全局共享布局（V2）。
 *
 * - 所有页面共用的 sticky 顶栏：品牌、主导航（SPA NavLink）、账户区、主题切换。
 * - 账户区已登录 = 头像/用户名下拉（账号与会员、主题切换、退出登录）；
 *   未登录 = 「登录」按钮，走 OAuth 授权。
 * - 移动端 ≤768px 导航收进汉堡菜单。
 * - 剧场模式 /conversation* 不渲染完整顶栏，只保留一个返回首页按钮。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, User, Crown, LogOut, Sun, Moon, ArrowLeft, Globe, Check,
  PenLine, Library, BookOpen, Users, UserRound } from "lucide-react";
import "../styles/covers.css";
import { useTheme } from "../hooks/use-theme";
import { SkoobLogo } from "../components/SkoobLogo";
import { RecentAgentSessions } from "./agent/RecentAgentSessions";
import { useMembership } from "../hooks/use-membership";
import { logout, startOAuthLogin } from "../lib/account";
import { useI18n, type Locale } from "../i18n";

const NAV_ITEMS = [
  { to: "/create", key: "nav.create" },
  { to: "/agents", key: "nav.agents" },
  { to: "/deconstruction", key: "nav.deconstruction" },
  { to: "/deai", key: "nav.deai" },
  { to: "/covers", key: "nav.covers" },
  { to: "/library", key: "nav.library" },
  { to: "/settings", key: "nav.settings" },
] as const;

/**
 * 手机上的底部导航 —— 常规 APP 的样子。
 *
 * 汉堡抽屉不是移动端的标准形态：主要去处被藏在一次点击之后，用户不点开就
 * 不知道这个应用能干什么。底部固定栏一直在，切换只要一下。
 *
 * ── 五个 ──
 *
 * 五个是底栏的上限（390px 屏上每个 78px，再多就窄到点不准）。这五个是
 * 日常会反复进出的：写、看自己写的、拆书拿模板、找角色，加一个「我的」。
 *
 * 天工AI检测、导入、官网不在这里——它们是偶尔用一次的工具，在「我的」页面
 * 里列着，不是被删掉了。
 */
const TAB_ITEMS = [
  { to: "/create", key: "nav.create", Icon: PenLine },
  { to: "/library", key: "nav.library", Icon: Library },
  { to: "/deconstruction", key: "nav.deconstruction", Icon: BookOpen },
  { to: "/agents", key: "nav.agents", Icon: Users },
  { to: "/settings", key: "nav.mine", Icon: UserRound },
] as const;

/**
 * 底部导航栏。只在窄屏出现（CSS 控制），并且**只在闸内的主页面**上。
 *
 * 工作台、剧场、影游播放这类沉浸页不显示：它们自己占满整屏、底部还有自己的
 * 操作条，再压一条导航就把内容挤没了。
 */
function BottomNav() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const ref = useRef<HTMLElement | null>(null);

  /*
   * 把底栏的**实际高度**写进 CSS 变量，页面据此留出下边距。
   *
   * 原来是 `padding-bottom: calc(49px + …)` —— 把底栏高度抄了一份当常量。
   * 顶栏那边已经犯过同样的错（写死 top: 57px），字号一改、多一行文字，
   * 内容就会被底栏压住或者多出一条空白，而这种偏差在桌面上永远看不见。
   *
   * 底栏不显示时（沉浸页）要归零，否则页面底部会白留一块。
   */
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty("--app-tabbar-h", "0px");
      return;
    }
    const apply = () => root.style.setProperty("--app-tabbar-h", `${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--app-tabbar-h", "0px");
    };
    // 依赖 pathname：沉浸页不渲染底栏，这时要把变量归零。
  }, [pathname]);

  // 沉浸页不挂底栏。前缀匹配，子路由一并算上。
  const IMMERSIVE = ["/workbench", "/conversation", "/auto", "/film/"];
  if (pathname === "/agent" || pathname.startsWith("/agent/") || IMMERSIVE.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p))) {
    return null;
  }

  return (
    <nav className="app-tabbar" ref={ref}>
      {TAB_ITEMS.map(({ to, key, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `app-tab${isActive ? " is-active" : ""}`}
        >
          <Icon size={19} />
          <span>{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function UserAvatar({ user }: { user: { username?: string; email?: string } | null }) {
  const name = user?.username ?? user?.email ?? "?";
  const initial = name.slice(0, 1).toUpperCase();
  return (
    <span className="app-avatar" title={name}>
      {initial}
    </span>
  );
}

function AccountDropdown() {
  const membership = useMembership();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    await logout().catch(() => undefined);
    await membership.refresh();
    navigate("/create");
  };

  if (membership.loading) {
    return <span className="app-user-loading">…</span>;
  }

  if (!membership.loggedIn) {
    return (
      <button
        className="app-btn app-btn-primary"
        onClick={() => startOAuthLogin(window.location.href)}
      >
        {t("layout.login")}
      </button>
    );
  }

  return (
    <div className="app-account" ref={ref}>
      <button
        className="app-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <UserAvatar user={membership.user} />
        <span className="app-account-name">
          {membership.user?.username ?? membership.user?.email ?? t("layout.account")}
        </span>
        {membership.isMember && <Crown size={13} className="app-crown" />}
      </button>
      {open && (
        <div className="app-dropdown" role="menu">
          <button className="app-dropdown-item" onClick={() => { setOpen(false); navigate("/settings/account"); }}>
            <User size={14} /> {t("layout.account_member")}
          </button>
          <button className="app-dropdown-item" onClick={() => { setOpen(false); toggleTheme(); }}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? t("layout.theme_to_light") : t("layout.theme_to_dark")}
          </button>
          <div className="app-dropdown-divider" />
          <button className="app-dropdown-item app-dropdown-danger" onClick={handleLogout}>
            <LogOut size={14} /> {t("layout.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const options: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: "zh", label: "中文" },
    { value: "en", label: "English" },
  ];

  return (
    <div className="app-lang" ref={ref}>
      <button
        className="app-lang-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Language"
      >
        <Globe size={15} />
        <span className="app-lang-label">{locale === "zh" ? "中" : "EN"}</span>
      </button>
      {open && (
        <div className="app-dropdown" role="menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`app-dropdown-item ${locale === opt.value ? "is-on" : ""}`}
              onClick={() => { setLocale(opt.value); setOpen(false); }}
            >
              {opt.label}
              {locale === opt.value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const headerRef = useRef<HTMLElement | null>(null);

  /*
   * 把顶栏的**实际高度**写进一个 CSS 变量。
   *
   * 手机上的导航抽屉要从顶栏下沿开始铺，原来写死 `top: 57px`。顶栏一改内边距、
   * 换个字号、或者哪天多一行提示条，抽屉就会盖住顶栏或者在中间露一道缝——
   * 而这种偏差在桌面上永远看不见。量出来最省事，也不会再过期。
   */
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="app-header" ref={headerRef}>
      <div className="app-header-inner">
        <NavLink to="/create" className="app-brand">
          <SkoobLogo className="app-brand-logo" />
          <strong className="app-brand-name">焚诀</strong>
        </NavLink>

        {/*
          手机上的主导航是**底栏**（BottomNav），不是汉堡抽屉。

          抽屉那套连同它的 Portal 一起删了：汉堡把主要去处藏在一次点击之后，
          用户不点开就不知道这个应用能干什么，而底栏一直在。
          （抽屉当初还踩了个坑：顶栏的 backdrop-filter 会成为 fixed 后代的
          包含块，抽屉被压成 33px——这也是它不该长在顶栏里的一个旁证。）
        */}
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-nav-link${isActive ? " is-active" : ""}`}
            >
              {t(item.key)}
            </NavLink>
          ))}
          {/* 官网已移植进本 SPA（/site），走内部路由不新开标签页 */}
          <NavLink
            to="/site"
            className={({ isActive }) => `app-nav-link${isActive ? " is-active" : ""}`}
          >
            {t("nav.website")}
          </NavLink>
        </nav>

        <div className="app-header-actions">
          <RecentAgentSessions />
          <NavLink to="/covers" className={({ isActive }) => `app-cover-mobile${isActive ? " is-active" : ""}`}>{t("nav.covers")}</NavLink>
          <button
            className="app-theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? t("layout.theme_to_light") : t("layout.theme_to_dark")}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <LanguageSwitcher />
          <div className="app-account-desktop">
            <AccountDropdown />
          </div>
        </div>
      </div>
    </header>
  );
}

function ConversationBack() {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <button
      className="app-conversation-back"
      onClick={() => navigate("/create")}
      title={t("layout.back_home")}
    >
      <ArrowLeft size={18} />
    </button>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const isConversation = pathname.startsWith("/conversation");

  return (
    <div className="app-layout">
      {isConversation ? <ConversationBack /> : <Header />}
      <main className="app-main">
        <Outlet />
      </main>
      {/* 手机上的底部导航。宽屏不显示——那边顶栏那排就够了。 */}
      <BottomNav />
    </div>
  );
}
