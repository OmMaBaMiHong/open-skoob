/**
 * App —— 路由入口
 */
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireLogin } from "./components/RequireLogin";
import { CreateHomePage } from "./pages/CreateHomePage";
import { AgentConversationPage } from "./pages/AgentConversationPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { WorkbenchGraphPage } from "./pages/WorkbenchGraphPage";
import { ConversationRoute } from "./pages/ConversationRoute";
import { SharedTheaterPage } from "./pages/SharedTheaterPage";
import { FilmHomePage } from "./pages/FilmHomePage";
import { FilmPlayerPage } from "./pages/FilmPlayerPage";
import { AutoMode } from "./pages/AutoMode";
import { AgentsPage } from "./pages/AgentsPage";
import { AddAgentPage } from "./pages/AddAgentPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PricingPage } from "./pages/PricingPage";
import { CoversPage } from "./pages/CoversPage";
import { LibraryPage } from "./pages/LibraryPage";
import { BookDetailPage } from "./pages/BookDetailPage";
import { DeconstructionPage } from "./pages/DeconstructionPage";
import { DeAiPage } from "./pages/DeAiPage";
import { ScanPage } from "./pages/ScanPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage";
import { TruthFilesPage } from "./pages/TruthFilesPage";
import { CloudAuthorizePage } from "./pages/CloudAuthorizePage";
import { SiteHomePage } from "./pages/SiteHomePage";
import { SiteDocsPage } from "./pages/SiteDocsPage";

/** 设置页内部按 URL 切 tab：/settings/models /settings/routing /settings/account。 */
function SettingsLayout() {
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/create" replace />} />

      {/* 分享页：公开只读，**在登录闸门外**——拿到链接的人不该被要求先注册。
          后端也只按 token 读那一份快照，取不到书里的任何别的东西。 */}
      <Route path="/share/:token" element={<SharedTheaterPage />} />

      {/* 创作首页本身公开可浏览（产品流程：点真正的创作动作时才拦登录，
          拦截点在 CreateHomePage 的发送动作里，直接跳中转站授权页） */}
      <Route element={<AppLayout />}>
        <Route path="/create" element={<CreateHomePage />} />
      </Route>

      {/* 登录闸门：工作台其余路由都在闸内；/pricing 与 /site* 公开 */}
      <Route element={<RequireLogin><AppLayout /></RequireLogin>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/agent" element={<AgentConversationPage />} />
        <Route path="/agent/:sessionId" element={<AgentConversationPage />} />
        {/* 无 bookId：先走意图卡建书，确认后再带真 id 回到本路由 */}
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/workbench/:bookId" element={<WorkbenchPage />} />
        {/* 写书侧独立图谱页：左侧「图谱档案」入口跳到这里 */}
        <Route path="/workbench/:bookId/graph" element={<WorkbenchGraphPage />} />
        <Route path="/auto" element={<AutoMode />} />
        <Route path="/auto/:bookId" element={<AutoMode />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/new" element={<AddAgentPage />} />
        <Route path="/covers" element={<CoversPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/library/:bookId" element={<BookDetailPage />} />
        <Route path="/deconstruction" element={<DeconstructionPage />} />
        <Route path="/deconstruction/:slug" element={<DeconstructionPage />} />
        {/* 天魔扫榜：网文榜单市场分析（报告=AI 生成，页面本身在闸内，生成时再拦会员） */}
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/deai" element={<DeAiPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/truth/:bookId" element={<TruthFilesPage />} />
        <Route path="/project-settings" element={<ProjectSettingsPage />} />

        {/* 设置直接打开模型配置，沿用子页的一排 Tab 导航。 */}
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="models" replace />} />
          <Route path="models" element={<SettingsPage tab="models" />} />
          <Route path="routing" element={<SettingsPage tab="routing" />} />
          <Route path="account" element={<SettingsPage tab="account" />} />
          <Route path="agent" element={<SettingsPage tab="agent" />} />
        </Route>
      </Route>

      {/* 剧场模式保留独立入口，布局内只显示一个浮动返回按钮 */}
      <Route element={<RequireLogin><AppLayout /></RequireLogin>}>
        <Route path="/conversation" element={<ConversationRoute />} />
        <Route path="/conversation/:bookId" element={<ConversationRoute />} />
        {/* 互动影游：四种模式之一。运行时与剧场相反 —— 确定性状态机，播放零 LLM。 */}
        <Route path="/film" element={<FilmHomePage />} />
        <Route path="/film/:projectId" element={<FilmPlayerPage />} />
      </Route>

      {/* 会员门的统一承接页：所有 403 / 锁定入口都收敛到这里 */}
      <Route path="/pricing" element={<PricingPage />} />

      {/* 官网（营销站）与文档中心：自带领航/返回，不套 AppLayout 顶栏 */}
      <Route path="/site/connect" element={<CloudAuthorizePage />} />
      <Route path="/site" element={<SiteHomePage />} />
      <Route path="/site/docs" element={<SiteDocsPage />} />
      <Route path="/site/docs/:docId" element={<SiteDocsPage />} />

      <Route path="*" element={<Navigate to="/create" replace />} />
    </Routes>
  );
}
