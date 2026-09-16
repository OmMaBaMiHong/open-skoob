/**
 * ProjectSettingsPage —— 项目设置
 *
 * 功能：
 * 1. 通用设置（语言、主题）
 * 2. 模型配置
 * 3. 认证设置
 * 4. 集成设置
 * 5. 导入设置
 * 6. 日志设置
 */

import { useState } from "react";
import {
  Settings, Plug, Shield, Download, Activity,
  Globe, Palette, Key, Bell,
} from "lucide-react";

type SettingsTab = "general" | "models" | "auth" | "integrations" | "import" | "logs";

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
  { id: "general", label: "通用", icon: Settings },
  { id: "models", label: "模型", icon: Plug },
  { id: "auth", label: "认证", icon: Shield },
  { id: "integrations", label: "集成", icon: Key },
  { id: "import", label: "导入", icon: Download },
  { id: "logs", label: "日志", icon: Activity },
];

export function ProjectSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  return (
    <div className="page">
      <header className="page-top">
        <h1 className="page-title">项目设置</h1>
        <nav className="page-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "is-on" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="page-body">
        <p className="page-desc">配置你的项目参数</p>

        {activeTab === "general" && (
          <div className="settings-section">
            <h3>通用设置</h3>
            <div className="settings-form">
              <div className="form-group">
                <label><Globe size={14} /> 语言</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as "zh" | "en")}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="form-group">
                <label><Palette size={14} /> 主题</label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as "light" | "dark")}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === "models" && (
          <div className="settings-section">
            <h3>模型配置</h3>
            <p>配置 AI 模型 API Key 和参数</p>
            <div className="settings-form">
              <div className="form-group">
                <label><Key size={14} /> OpenAI API Key</label>
                <input type="password" placeholder="sk-..." />
              </div>
              <div className="form-group">
                <label><Key size={14} /> Anthropic API Key</label>
                <input type="password" placeholder="sk-ant-..." />
              </div>
            </div>
          </div>
        )}

        {activeTab === "auth" && (
          <div className="settings-section">
            <h3>认证设置</h3>
            <p>管理登录和认证方式</p>
          </div>
        )}

        {activeTab === "integrations" && (
          <div className="settings-section">
            <h3>集成设置</h3>
            <p>配置外部服务集成</p>
            <div className="settings-form">
              <div className="form-group">
                <label><Bell size={14} /> 通知渠道</label>
                <select>
                  <option value="">无</option>
                  <option value="webhook">Webhook</option>
                  <option value="telegram">Telegram</option>
                  <option value="feishu">飞书</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === "import" && (
          <div className="settings-section">
            <h3>导入设置</h3>
            <p>配置导入参数</p>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="settings-section">
            <h3>日志设置</h3>
            <p>查看系统日志</p>
          </div>
        )}
      </div>
    </div>
  );
}
