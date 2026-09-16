import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AUTH_CHANGED_EVENT, readAuth } from "../../lib/auth-storage";
import { API_ORIGIN } from "../../lib/api-origin";
import { fetchJson } from "../../lib/api";

/** 本浏览器按账号记住跳过状态；新用户始终可以直接发送消息。 */
export function AgentOnboarding() {
  const key = `skoob:agent-intro:v1:${API_ORIGIN}:${readAuth()?.userId ?? "anonymous"}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let controller: AbortController | undefined;
    const check = () => {
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal, identity = readAuth();
      setHidden(true);
      if (!identity) return;
      try { if (localStorage.getItem(`skoob:agent-intro:v1:${API_ORIGIN}:${identity.userId}`) === "done") return; } catch { /* Server state remains authoritative. */ }
      void fetchJson<{ configured: boolean }>("/user-agent", { signal }).then(value => {
        if (!signal.aborted) setHidden(value.configured !== false);
      }).catch(() => undefined);
    };
    check();
    const events = [AUTH_CHANGED_EVENT, "storage", "skoob:user-agent-saved"];
    events.forEach(event => window.addEventListener(event, check));
    return () => { controller?.abort(); events.forEach(event => window.removeEventListener(event, check)); };
  }, [key]);
  const dismiss = () => { setHidden(true); try { localStorage.setItem(key, "done"); } catch { /* 当前页面仍可以跳过。 */ } };
  if (hidden) return null;
  return <aside className="ga-onboarding" aria-label="个人智能体引导"><div><strong>给你的创作化身一个名字？</strong><p>你已经拥有一个专属智能体。花一分钟设置性格，也可以先聊起来。</p></div><div><Link to="/settings/agent" onClick={dismiss}>设置我的智能体</Link><button type="button" onClick={dismiss}>先聊聊</button></div></aside>;
}
