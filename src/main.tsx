import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { completeOAuthLogin } from "./lib/account";
import { I18nProvider } from "./i18n/index";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/pages.css";

// 先用浏览器绑定的一次性凭证换取令牌，再渲染依赖登录态的页面。
void completeOAuthLogin().then(() => {
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>
);
});
