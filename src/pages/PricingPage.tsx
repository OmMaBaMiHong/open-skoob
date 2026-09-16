/**
 * PricingPage —— 会员套餐承接页（/pricing）
 *
 * 站内**唯一**的购买入口：所有会员门（世界模拟引擎、模板下载、
 * 后端 403 MEMBER_REQUIRED…）都收敛到这里，不再各自直接甩去中转站。
 *
 * 分工（沿用老前端定案）：
 *   本端  展示套餐 + 当前会员状态 + 选套餐
 *   中转站 订单、支付、权益下发
 * 「立即购买」深链 `${sub2apiUrl}/purchase?plan=xxx&plan_id=N`，让收银页预选。
 *
 * 未登录时按钮变成「授权登录后购买」，授权完回到本页（returnTo=当前地址），
 * 用户不会在跳转链路里丢掉购买意图。
 */
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Check, Crown, LogIn, ExternalLink, RefreshCw, Loader2, ChevronLeft } from "lucide-react";
import { useMembership } from "../hooks/use-membership";
import {
  startOAuthLogin, openRelay, openCheckout,
  consumeOAuthResult, oauthReasonText,
} from "../lib/account";
import { PLANS, SUB2API_PLAN_IDS, MEMBER_BENEFITS } from "../types/plans";

/** 会员门跳过来时带的原因，用来在页头点明"为什么看到这一页"。 */
const GATE_REASONS: Readonly<Record<string, string>> = {
  simulate: "「世界模拟引擎」是会员功能",
  member_required: "该操作需要会员",
  template: "模板下载是会员权益",
};

export function PricingPage() {
  const m = useMembership();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const gate = params.get("from");
  const gateText = gate ? GATE_REASONS[gate] : null;

  // 授权回跳：消费 ?oauth=... 并刷新会员状态
  useEffect(() => {
    const r = consumeOAuthResult();
    if (!r) return;
    if (r.ok) {
      setNotice("授权成功，可以选套餐了");
      void m.refresh();
      setTimeout(() => setNotice(null), 3200);
    } else {
      setError(oauthReasonText(r.reason));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await m.refresh();
    setRefreshing(false);
  };

  const onBuy = (planId: string) => {
    if (!m.loggedIn) {
      // 授权后回到本页，购买意图不丢
      startOAuthLogin(window.location.href);
      return;
    }
    openCheckout(m.sub2apiUrl, planId, SUB2API_PLAN_IDS[planId]);
  };

  return (
    <div className="pr">
      <header className="pr-top">
        {/*
          这页在登录闸**外面**（未登录也要能看方案），所以它不套 AppLayout，
          也就没有全局顶栏。已登录的人从这里进来就没有回工作台的路——
          自己补一个入口，别让人只能靠浏览器后退。
        */}
        <div className="pr-top-left">
          <button className="pr-btn" onClick={() => nav(m.loggedIn ? "/create" : "/site")}>
            <ChevronLeft size={13} /> {m.loggedIn ? "返回工作台" : "返回首页"}
          </button>
          <span className="pr-badge">会员套餐</span>
        </div>
        <div className="pr-top-right">
          {m.loading ? null : m.loggedIn ? (
            <>
              <span className="pr-user">{m.user?.email ?? m.user?.username ?? "已登录"}</span>
              {m.isMember ? (
                <span className="pr-tag is-member"><Crown size={12} /> {m.plan ?? "会员"}</span>
              ) : (
                <span className="pr-tag">未开通会员</span>
              )}
              <button className="pr-btn" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 刷新
              </button>
            </>
          ) : (
            <>
              <button className="pr-btn" onClick={() => openRelay(m.sub2apiUrl, "register")}>
                去官网注册 <ExternalLink size={11} />
              </button>
              <button className="pr-btn is-primary" onClick={() => startOAuthLogin(window.location.href)}>
                <LogIn size={13} /> 授权登录
              </button>
            </>
          )}
        </div>
      </header>

      <main className="pr-main">
        {error && <div className="pr-alert is-error">{error}</div>}
        {notice && <div className="pr-alert is-ok">{notice}</div>}
        {gateText && !m.isMember && (
          <div className="pr-gate">{gateText} —— 开通后即可使用；不开通也能用「快速直出」继续创作。</div>
        )}

        <div className="pr-head">
          <div className="pr-eyebrow">MEMBERSHIP / 会员</div>
          <h1>会员，为创作增加更多能力</h1>
          <p className="pr-sub">
            {m.isMember && m.expiresAt
              ? `你已是会员（${m.plan ?? "会员"}）· 有效期至 ${String(m.expiresAt).replace("T", " ").slice(0, 16)}，可续费或升级`
              : m.loggedIn
                ? "选择会员周期，具体功能以账号当前权益为准"
                : "授权登录后即可开通会员套餐"}
          </p>
        </div>

        <div className="pr-benefits">
          {MEMBER_BENEFITS.map((b) => (
            <span key={b} className="pr-benefit"><Check size={12} /> {b}</span>
          ))}
        </div>

        <div className="pr-plans">
          {PLANS.map((plan) => (
            <div key={plan.id} className={`pr-plan ${plan.featured ? "is-featured" : ""}`}>
              {plan.featured && <span className="pr-plan-badge">长期使用</span>}
              <div className="pr-plan-head">
                <h2>{plan.name}</h2>
                <small>{plan.tagline}</small>
              </div>
              <div className="pr-plan-price">
                <strong>¥{plan.price}</strong>
                <span>{plan.unit}</span>
                {plan.save && <em>立省 {plan.save}</em>}
              </div>
              <ul className="pr-plan-benefits">
                {plan.benefits.map((b) => (
                  <li key={b}><Check size={13} /> <span>{b}</span></li>
                ))}
              </ul>
              <button
                className={`pr-plan-btn ${plan.featured ? "is-featured" : ""}`}
                onClick={() => onBuy(plan.id)}
              >
                {m.loggedIn ? (m.isMember ? "续费 / 升级" : "立即购买") : "授权登录后购买"}
                <ExternalLink size={12} />
              </button>
            </div>
          ))}
        </div>

        <p className="pr-foot">
          支付与权益下发由中转站（OpenSkoob）完成。成交价格、模型用量费用以结算页为准；购买后回到本页刷新并确认权益状态。
        </p>
      </main>
    </div>
  );
}
