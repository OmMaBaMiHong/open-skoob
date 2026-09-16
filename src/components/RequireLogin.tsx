/**
 * RequireLogin —— 全局登录闸门。
 *
 * 套在 AppLayout 外面：未登录时整个工作台（设置页、AI 检测、写书……）都不渲染，
 * 只给一个授权登录入口。后端同时有 /api/v1/* 的 401 LOGIN_REQUIRED 闸（server.ts），
 * 这里是前端那一半：登录态一失效（use-membership 收到 401 回调）就切回本页。
 *
 * /pricing 与 /site* 不在闸内：定价页是登录 CTA 的落点，官网是公开的。
 */
import { useState, type ReactNode } from "react";
import { Loader2, LogIn } from "lucide-react";
import { SkoobLogo } from "../components/SkoobLogo";
import { useMembership } from "../hooks/use-membership";
import { startOAuthLogin, openRelay } from "../lib/account";

export function RequireLogin({ children }: { readonly children: ReactNode }) {
  const membership = useMembership();
  const [starting, setStarting] = useState(false);

  if (membership.loading) {
    return (
      <div className="rl-screen">
        <Loader2 size={22} className="spin" />
        <span>正在确认登录状态…</span>
      </div>
    );
  }

  if (!membership.loggedIn) {
    return (
      <div className="rl-screen">
        <div className="rl-card">
          <div className="rl-brand"><SkoobLogo className="rl-brand-logo" /> 焚诀 Skoob</div>
          <h1>先登录，再进工作台</h1>
          <p>
            模型配置、API Key、天工AI检测、写书与拆书都属于账号权限。
            授权登录后即可使用；会员功能（天工 AI 检测与改写、天衍仿真、模板订阅）以账号的会员状态为准。
          </p>
          <button
            className="rl-btn"
            disabled={starting}
            onClick={() => { setStarting(true); startOAuthLogin(window.location.href); }}
          >
            {starting ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
            授权登录
          </button>
          <div className="rl-links">
            <button type="button" onClick={() => openRelay(membership.sub2apiUrl, "register")}>注册账号</button>
            <span>·</span>
            <a href="/pricing">查看会员方案</a>
            <span>·</span>
            <a href="/site/docs">文档中心</a>
          </div>
          <small>
            登录态保存在这台浏览器里，随请求发给后端；后端不保存任何登录状态。未登录时后端会拒绝请求（401 LOGIN_REQUIRED）。
          </small>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
