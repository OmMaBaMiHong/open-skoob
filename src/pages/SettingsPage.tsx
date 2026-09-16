/**
 * SettingsPage —— 模型配置 + 账号会员
 *
 * 模型配置是跑通流程的前置条件：没有可用的 API Key，六步编排第一步就
 * 挂在 "Connection error."。这一页把 v1 的服务配置能力搬过来：
 *   列服务 → 填 Key → 测连通 → 选默认服务/模型 → 保存
 *
 * 后端契约见 packages/studio/src/api/server.ts 的 /api/v1/services/*。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Check, Loader2, AlertCircle, Eye, EyeOff,
  Plug, RefreshCw, User, Crown, LogOut, ExternalLink,
  Route, Trash2, Zap, LogIn, Bot } from "lucide-react";
import {
  fetchServices, fetchServicesConfig, saveServicesConfig, saveServiceFull,
  fetchServiceSecret, type ServiceSecretStatus, testService, fetchServiceModels, deleteService,
  fetchModelOverrides, saveModelOverrides, saveDefaultModel, fetchProjectLlm,
  fetchAllModelGroups,
  type ServiceListItem, type ServicesConfig, type ModelInfo, type ServiceTestResult,
  type ServiceConfigEntry, type ModelOverrideValue, type ProjectLlmInfo,
  type ModelGroup,
} from "../lib/api";
import { OVERRIDABLE_AGENTS } from "../types/creation-loop";
import { fetchRoutePurposes, type RoutePurpose } from "../lib/api";
import { MyAgentTab } from "./MyAgentTab";
import { useMembership } from "../hooks/use-membership";
import { useI18n } from "../i18n";
import {
  logout, openRelay, startOAuthLogin, consumeOAuthResult, oauthReasonText,
  fetchAccountStatus,
} from "../lib/account";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";

/**
 * 把 /services/config 的 services[] 匹配到列表里的服务 id。
 * 自定义服务在配置里是 { service:"custom", name:"X" }，而列表 id 是 `custom:X`。
 */
function matchConfigEntry(
  entries: ReadonlyArray<ServiceConfigEntry>,
  serviceId: string,
): ServiceConfigEntry | undefined {
  if (serviceId.startsWith("custom:")) {
    const name = decodeURIComponent(serviceId.slice("custom:".length));
    return entries.find((e) => e.service === "custom" && (e.name ?? "") === name);
  }
  return entries.find((e) => e.service === serviceId);
}

const GROUP_LABELS: Readonly<Record<string, string>> = {
  aggregator: "中转 / 聚合",
  overseas: "海外",
  china: "国内",
  custom: "自定义",
};

export function SettingsPage({ tab }: { tab: "models" | "routing" | "account" | "agent" }) {
  const { t } = useI18n();
  return (
    <div className="page">
      <header className="page-top">
        <nav className="page-tabs">
          <NavLink to="/settings/models" className={({ isActive }) => isActive ? "is-on" : ""}>
            <Plug size={13} /> {t("settings.models")}
          </NavLink>
          <NavLink to="/settings/routing" className={({ isActive }) => isActive ? "is-on" : ""}>
            <Route size={13} /> {t("settings.routing")}
          </NavLink>
          <NavLink to="/settings/account" className={({ isActive }) => isActive ? "is-on" : ""}>
            <User size={13} /> {t("settings.account")}
          </NavLink>
          <NavLink to="/settings/agent" className={({ isActive }) => isActive ? "is-on" : ""}>
            <Bot size={13} /> 我的智能体
          </NavLink>
        </nav>
      </header>
      <div className="page-body">
        {tab === "models" ? <ModelsTab />
          : tab === "routing" ? <RoutingTab />
          : tab === "agent" ? <MyAgentTab />
          : <AccountTab />}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   模型配置
   ══════════════════════════════════════════════════════════════════ */
function ModelsTab() {
  const [services, setServices] = useState<ReadonlyArray<ServiceListItem>>([]);
  const [config, setConfig] = useState<ServicesConfig | null>(null);
  /** 项目顶层生效值：服务条目没写 stream/temperature 时用它兜底显示。 */
  const [projectLlm, setProjectLlm] = useState<ProjectLlmInfo>({});
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [list, cfg, proj, acct] = await Promise.all([
        fetchServices(),
        fetchServicesConfig(),
        fetchProjectLlm().catch(() => ({} as ProjectLlmInfo)),
        fetchAccountStatus().catch(() => null),
      ]);
      setServices(list);
      setConfig(cfg);
      setProjectLlm(proj);
      setSiteUrl(acct?.sub2apiUrl ?? null);
      setSelected((prev) => prev ?? cfg.service ?? list.find((s) => s.connected)?.service ?? list[0]?.service ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取服务配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** 按分组归类，已连接的排前面。 */
  const grouped = useMemo(() => {
    const map = new Map<string, ServiceListItem[]>();
    for (const s of services) {
      const g = s.group ?? "custom";
      (map.get(g) ?? map.set(g, []).get(g)!).push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(b.connected) - Number(a.connected));
    }
    return [...map.entries()];
  }, [services]);

  const connectedCount = services.filter((s) => s.connected).length;

  const setDefaultService = async (service: string) => {
    try {
      const res = await saveServicesConfig({ service });
      /*
       * 换了服务商，原来的默认模型多半不属于新那家——后端会清掉它。
       * 这件事必须说：不说的话用户下次进来发现默认模型没了，只会以为是 bug。
       */
      const cleared = res.cleared ?? [];
      setConfig((c) => (c ? {
        ...c, service,
        ...(cleared.includes("defaultModel") ? { defaultModel: null } : {}),
      } : c));
      setNotice(cleared.length > 0
        ? `默认服务商已设为 ${service}；原来的默认模型不在这家，已清空，请重新选一个`
        : `默认服务商已设为 ${service}`);
      setTimeout(() => setNotice(null), cleared.length > 0 ? 4200 : 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  /**
   * 设默认模型 —— **模型和它所属的服务商一起存**。
   *
   * 原来这里配的是 `config.service`（当前的默认服务商），而模型是从某一张
   * 服务商卡片的列表里点出来的。两者不是一回事：在「Env LLM」卡片里点
   * agnes-2.5-pro，存下来却是「deepseek + agnes-2.5-pro」——请求打到
   * deepseek，人家当然不认识这个模型。
   *
   * 点一个模型的意思就是「以后走它」，所以默认服务商跟着改到它所在那家。
   */
  const setDefaultModel = async (model: string, fromService: string) => {
    try {
      // 用 /project/default-model：它会同时同步顶层 llm 镜像字段，
      // 只写 /services/config 会漏掉那份镜像。
      await saveDefaultModel({ defaultModel: model, service: fromService });
      setConfig((c) => (c ? { ...c, defaultModel: model, service: fromService } : c));
      setNotice(
        fromService === config?.service
          ? `默认模型已设为 ${model}`
          : `默认模型已设为 ${model}（服务商同时切到 ${fromService}）`,
      );
      setTimeout(() => setNotice(null), 3200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  if (loading) {
    return <div className="st-loading"><Loader2 size={20} className="spin" /> 读取配置中…</div>;
  }

  return (
    <div className="st-models">
      <aside className="st-list">
        <div className="st-list-head">
          服务商
          <span className="st-list-count">{connectedCount} 个已连接</span>
        </div>
        {/* 新建自定义服务入口：后端支持 custom 服务，前端此前缺入口 */}
        <button
          className={`st-svc ${creating ? "is-on" : ""}`}
          onClick={() => { setCreating(true); setSelected(null); setError(null); setNotice(null); }}
        >
          <span className="st-svc-dot" />
          <span className="st-svc-label">＋ 新增自定义服务</span>
        </button>
        {grouped.map(([group, list]) => (
          <div key={group} className="st-group">
            <div className="st-group-label">{GROUP_LABELS[group] ?? group}</div>
            {list.map((s) => (
              <button
                key={s.service}
                className={`st-svc ${selected === s.service ? "is-on" : ""}`}
                onClick={() => { setSelected(s.service); setCreating(false); setError(null); setNotice(null); }}
              >
                <span className={`st-svc-dot ${s.connected ? "is-connected" : ""}`} />
                <span className="st-svc-label">{s.label}</span>
                {config?.service === s.service && <span className="st-svc-default">默认</span>}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="st-detail">
        {error && <div className="st-error"><AlertCircle size={14} /> {error}</div>}
        {notice && <div className="st-notice"><Check size={14} /> {notice}</div>}

        {creating ? (
          <ServiceDetail
            key="new-custom"
            service={{ service: "custom", label: "新的自定义服务", group: "custom", connected: false }}
            isDefault={false}
            defaultModel={null}
            configEntry={undefined}
            projectLlm={projectLlm}
            siteUrl={siteUrl}
            isCreating
            onCreated={(id) => {
              setCreating(false);
              setSelected(id);
              setNotice(`已新增 ${id}`);
              setTimeout(() => setNotice(null), 2600);
              void reload();
            }}
            onDefaultModel={(m, from) => void setDefaultModel(m, from)}
            onSetDefault={(id) => void setDefaultService(id)}
            onChanged={() => void reload()}
          />
        ) : selected ? (
          <ServiceDetail
            key={selected}
            service={services.find((s) => s.service === selected)!}
            isDefault={config?.service === selected}
            defaultModel={config?.defaultModel ?? null}
            configEntry={matchConfigEntry(config?.services ?? [], selected)}
            projectLlm={projectLlm}
            siteUrl={siteUrl}
            onDefaultModel={(m, from) => void setDefaultModel(m, from)}
            onSetDefault={(id) => void setDefaultService(id)}
            onChanged={() => void reload()}
          />
        ) : (
          <div className="st-empty">左侧选一个服务商，或点「＋ 新增自定义服务」</div>
        )}
      </main>
    </div>
  );
}

/* ── 单个服务商详情 ── */
/**
 * 后端/上游的错误未必是字符串——上游把 `{code, message}` 原样透出时，
 * 直接塞进 JSX 会让整页白屏（"Objects are not valid as a React child"）。
 * 一个连接失败不该炸掉整个设置页，所以在这里统一压成文本。
 */
function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
    try { return JSON.stringify(error); } catch { /* 循环引用，落到下面 */ }
  }
  return "连接失败";
}

function ServiceDetail({
  service, isDefault, defaultModel, configEntry, projectLlm, siteUrl, onDefaultModel, onSetDefault, onChanged,
  isCreating, onCreated,
}: {
  readonly service: ServiceListItem;
  readonly isDefault: boolean;
  /** 设为默认服务商。以前只显示「默认」徽章、没有设为默认的入口——
      处理函数写好了却没接上,用户只能改默认模型,改不了默认服务商。 */
  readonly onSetDefault: (service: string) => void;
  readonly defaultModel: string | null;
  readonly configEntry: ServiceConfigEntry | undefined;
  readonly projectLlm: ProjectLlmInfo;
  /** 中转站地址，用于「去哪申请 key」的链接。 */
  readonly siteUrl: string | null;
  /**
   * 设为默认模型。**必须带上这个模型属于哪家服务商**——模型列表是按服务商
   * 卡片渲染的，只回传模型 id 的话，上层只能拿「当前默认服务商」去配，
   * 于是就配出「deepseek + agnes-2.5-pro」这种打不通的组合。
   */
  readonly onDefaultModel: (model: string, fromService: string) => void;
  readonly onChanged: () => void;
  /** 新建态：正在新增一个自定义服务（service 是临时占位）。 */
  readonly isCreating?: boolean;
  /** 新建态保存成功回调，参数为该自定义服务的完整 id（`custom:<name>`）。 */
  readonly onCreated?: (serviceId: string) => void;
}) {
  // 新建态 service.service="custom"，isCreating 时按自定义服务处理
  const isCustom = service.service === "custom" || service.service.startsWith("custom:");

  const [apiKey, setApiKey] = useState("");
  /*
   * 已存的 key **只有状态，没有明文**——后端不提供把 key 读回来的接口。
   * 所以输入框永远从空开始：空 = 不改；填了 = 覆盖。
   */
  const [savedKey, setSavedKey] = useState<ServiceSecretStatus>({ configured: false, last4: "" });
  const [reveal, setReveal] = useState(false);
  // 协议与流式：选错就是连不上。项目里 stream=false 时后端不发 draft:delta，
  // 整段响应走 POST 返回体——前端行为会跟着变，所以必须能在这里看到和改。
  const [apiFormat, setApiFormat] = useState<"chat" | "responses">("chat");
  const [stream, setStream] = useState(true);
  const [temperature, setTemperature] = useState("0.7");
  const [baseUrl, setBaseUrl] = useState("");
  const [customName, setCustomName] = useState("");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<ServiceTestResult | null>(null);
  const [models, setModels] = useState<ReadonlyArray<ModelInfo>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 切换服务时清理提示；保存后的配置回填不抹掉成功反馈。
  useEffect(() => { setResult(null); setMsg(null); setModels([]); }, [service.service, isCreating]);

  // 换服务商或保存后，把数据库配置回填到表单。
  useEffect(() => {
    setApiFormat(configEntry?.apiFormat ?? "chat");
    // 服务条目没写 stream/temperature 时，用项目顶层的生效值回填，
    // 而不是控件默认值——否则会把「实际非流式」显示成「流式开启」，
    // 用户一保存就真把 stream:true 写进去了。
    setStream(configEntry?.stream ?? projectLlm.stream ?? true);
    setTemperature(String(configEntry?.temperature ?? projectLlm.temperature ?? 0.7));
    setBaseUrl(configEntry?.baseUrl ?? "");
    setCustomName(configEntry?.name ?? "");
    // 新建态不拉已有 secret（占位 id "custom" 会读到别的 custom 服务的状态）
    setApiKey("");
    if (!isCreating) {
      void fetchServiceSecret(service.service)
        .then(setSavedKey)
        .catch(() => setSavedKey({ configured: false, last4: "" }));
    } else {
      setSavedKey({ configured: false, last4: "" });
    }
  }, [service.service, configEntry, projectLlm, isCreating]);

  const loadModels = useCallback(async (refresh = false) => {
    setLoadingModels(true);
    try { setModels(await fetchServiceModels(service.service, refresh)); }
    catch { setModels([]); }
    finally { setLoadingModels(false); }
  }, [service.service]);

  useEffect(() => { if (service.connected) void loadModels(); }, [service.connected, loadModels]);

  const test = async () => {
    setTesting(true); setResult(null); setMsg(null);
    try {
      const r = await testService(service.service, {
        apiKey, apiFormat, stream,
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      setResult(r);
      if (r.ok && r.models) setModels(r.models);
      // 后端探测出的真实协议/流式回填表单，用户能看到被纠正成什么
      if (r.ok && r.detected) {
        if (r.detected.apiFormat === "chat" || r.detected.apiFormat === "responses") {
          setApiFormat(r.detected.apiFormat);
        }
        if (typeof r.detected.stream === "boolean") setStream(r.detected.stream);
        if (isCustom && r.detected.baseUrl) setBaseUrl(r.detected.baseUrl);
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "测试失败" });
    } finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true); setMsg(null); setResult(null);
    try {
      // 新建态：用自定义名派生完整服务 id（`custom:<name>`），探测与落盘都用它。
      const svcId = isCreating ? `custom:${customName.trim() || "Custom"}` : service.service;
      const r = await saveServiceFull({
        serviceId: svcId,
        apiKey, apiFormat, stream,
        temperature: temperature.trim() === "" ? 0.7 : Number(temperature),
        isCustom,
        ...(isCustom ? { baseUrl: baseUrl.trim(), customName: customName.trim() } : {}),
      });
      setResult({ ok: true, modelCount: r.models.length, ...(r.detected ? { detected: r.detected } : {}) });
      if (isCreating) {
        onCreated?.(svcId);
        setMsg(`已新增 ${svcId}${r.selectedModel ? ` · 默认模型 ${r.selectedModel}` : ""}`);
      } else {
        setMsg(`已保存并设为默认${r.selectedModel ? ` · 默认模型 ${r.selectedModel}` : ""}`);
      }
      onChanged();
      void loadModels(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`删除「${service.label}」的配置和密钥？`)) return;
    setDeleting(true); setMsg(null);
    try {
      await deleteService(service.service);
      setApiKey(""); setModels([]); setResult(null);
      setMsg("配置已删除");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "删除失败");
    } finally { setDeleting(false); }
  };

  const busy = saving || testing || deleting;

  return (
    <div className="st-svc-detail">
      <header className="st-svc-head">
        <div>
          <h2>{service.label}</h2>
          <div className="st-svc-id">{service.service}</div>
          <ServiceQuickLinks serviceId={service.service} siteUrl={siteUrl} />
        </div>
        <div className="st-svc-actions">
          {isDefault
            ? <span className="st-tag is-ok"><Check size={12} /> 默认服务商</span>
            : !isCreating && service.connected && (
                <button className="st-btn" onClick={() => onSetDefault(service.service)} disabled={busy}>
                  设为默认
                </button>
              )}
          {!isCreating && (service.connected || isCustom) && (
            <button className="st-btn is-danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={13} /> 删除配置
            </button>
          )}
        </div>
      </header>

      {isCustom && (
        <div className="st-grid2">
          <section className="st-field">
            <label>服务名称</label>
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="例如：本地 Ollama" />
          </section>
          <section className="st-field">
            <label>Base URL</label>
            <input
              value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1" spellCheck={false}
            />
          </section>
        </div>
      )}

      <section className="st-field">
        <label>API Key</label>
        <div className="st-key-row">
          <input
            type={reveal ? "text" : "password"} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={savedKey.configured
              ? `已保存${savedKey.last4 ? ` ····${savedKey.last4}` : ""}，留空则不修改`
              : "粘贴该服务商的 API Key"}
            spellCheck={false}
          />
          <button className="st-icon-btn" onClick={() => setReveal((v) => !v)} title={reveal ? "隐藏" : "显示"}>
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </section>

      {/* 协议 / 流式：踩过坑的两个字段，必须可见可改 */}
      <div className="st-grid2">
        <section className="st-field">
          <label>协议类型</label>
          <select value={apiFormat} onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}>
            <option value="chat">Chat / Completions</option>
            <option value="responses">Responses</option>
          </select>
          <div className="st-field-hint">选错会直接连不上；测试连接会自动纠正。</div>
        </section>
        <section className="st-field">
          <label>流式响应</label>
          <label className="st-check">
            <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
            <span>{stream ? "开启" : "关闭"}</span>
          </label>
          <div className="st-field-hint">
            关闭时后端不发流式增量，整段响应随请求返回。
            {configEntry?.stream === undefined && projectLlm.stream !== undefined
              && `　当前值来自项目全局（${projectLlm.stream ? "开" : "关"}），保存后会固定到本服务商。`}
          </div>
        </section>
      </div>

      <div className="st-actions-row">
        <button className="st-btn" onClick={() => void test()} disabled={busy || (!apiKey.trim() && !savedKey.configured && !isCustom)}>
          {testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />} 测试连接
        </button>
        <button className="st-btn is-primary" onClick={() => void save()} disabled={busy || (!apiKey.trim() && !savedKey.configured && !isCustom)}>
          {saving ? <Loader2 size={13} className="spin" /> : null} 保存并设为默认
        </button>
        {msg && <span className="st-field-msg">{msg}</span>}
      </div>

      {result && (
        <section className={`st-result ${result.ok ? "is-ok" : "is-fail"}`}>
          {result.ok ? <Check size={15} /> : <AlertCircle size={15} />}
          <div>
            <div className="st-result-title">
              {result.ok ? `连接成功 · 探测到 ${result.modelCount} 个模型` : "连接失败"}
            </div>
            <div className="st-result-meta">
              {result.ok ? (
                <>
                  {result.detected?.apiFormat && <span>协议 {result.detected.apiFormat}</span>}
                  {result.detected?.stream !== undefined && <span>流式 {result.detected.stream ? "支持" : "不支持"}</span>}
                  {result.detected?.baseUrl && <span className="st-result-url">{result.detected.baseUrl}</span>}
                </>
              ) : errorText(result.error)}
            </div>
          </div>
        </section>
      )}

      <section className="st-field">
        <label>
          可用模型
          <button className="st-link-btn" onClick={() => void loadModels(true)} disabled={loadingModels}>
            <RefreshCw size={11} className={loadingModels ? "spin" : ""} /> 刷新
          </button>
        </label>
        {loadingModels ? (
          <div className="st-models-empty"><Loader2 size={14} className="spin" /> 探测中…</div>
        ) : models.length === 0 ? (
          <div className="st-models-empty">
            {service.connected ? "未探测到模型，试试「测试连接」或刷新" : "先配置 API Key"}
          </div>
        ) : (
          <div className="st-model-grid">
            {models.map((m) => (
              <button
                key={m.id}
                className={`st-model ${defaultModel === m.id ? "is-on" : ""}`}
                onClick={() => onDefaultModel(m.id, service.service)}
                title={`点击设为默认模型${m.contextWindow ? ` · 上下文 ${m.contextWindow.toLocaleString()}` : ""}`}
              >
                <span className="st-model-name">{m.name || m.id}</span>
                {m.contextWindow ? <span className="st-model-ctx">{Math.round(m.contextWindow / 1000)}k</span> : null}
                {defaultModel === m.id && <Check size={12} className="st-model-check" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <details className="st-advanced">
        <summary>高级参数</summary>
        <section className="st-field">
          <label>temperature</label>
          <div className="st-range-row">
            <input
              type="range" min="0" max="2" step="0.05"
              value={temperature} onChange={(e) => setTemperature(e.target.value)}
            />
            <input
              type="number" min="0" max="2" step="0.05"
              value={temperature} onChange={(e) => setTemperature(e.target.value)}
              className="st-range-num"
            />
          </div>
          <div className="st-field-hint">保存时随服务配置一起写入。</div>
        </section>
      </details>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   模型路由：每个 agent 走哪个模型
   ══════════════════════════════════════════════════════════════════ */
/** 下拉里一个选项 = 服务商 + 模型；用不可能出现在 id 里的分隔符编码。 */
const PICK_SEP = "\u001f";

interface RoutePick {
  /** null = 默认服务商；否则是 secrets / llm.services 的 key（deepseek / custom:openrouter）。 */
  readonly service: string | null;
  readonly model: string;
}

function encodePick(p: RoutePick): string {
  return `${p.service ?? ""}${PICK_SEP}${p.model}`;
}

function decodePick(v: string): RoutePick {
  const idx = v.indexOf(PICK_SEP);
  if (idx < 0) return { service: null, model: v };
  return { service: v.slice(0, idx) || null, model: v.slice(idx + 1) };
}

function RoutingTab() {
  /**
   * 用途清单来自后端（llm_route_purpose 表）。
   *
   * 拿不到就用前端内置的那份兜底——全新部署没跑种子脚本时表是空的，
   * 那时也得能配路由，不能白屏。
   */
  const [purposes, setPurposes] = useState<ReadonlyArray<RoutePurpose>>(
    OVERRIDABLE_AGENTS.map((a) => ({
      id: a.id, label: a.label, description: a.description, needsStrong: a.needsStrong ?? false,
    })),
  );
  useEffect(() => {
    let live = true;
    void fetchRoutePurposes().then((list) => {
      if (live && list.length > 0) setPurposes(list);
    });
    return () => { live = false; };
  }, []);

  const [picks, setPicks] = useState<Record<string, RoutePick>>({});
  /** 原始值：用户没动的行原样写回（手写 baseUrl 的旧形态不能被抹掉）。 */
  const [raw, setRaw] = useState<Record<string, ModelOverrideValue>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<ReadonlyArray<ModelGroup>>([]);
  const [defaultService, setDefaultService] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [ov, cfg, allGroups] = await Promise.all([
          fetchModelOverrides(),
          fetchServicesConfig(),
          fetchAllModelGroups().catch(() => [] as ReadonlyArray<ModelGroup>),
        ]);
        const next: Record<string, RoutePick> = {};
        for (const [agent, v] of Object.entries(ov)) {
          next[agent] = typeof v === "string"
            ? { service: null, model: v }
            : { service: v.service ?? null, model: v.model };
        }
        setPicks(next);
        setRaw(ov);
        setDefaultService(cfg.service);
        setDefaultModel(cfg.defaultModel);
        setGroups(allGroups);
      } catch (e) {
        setError(e instanceof Error ? e.message : "读取失败");
      } finally { setLoading(false); }
    })();
  }, []);

  const setPick = (agent: string, pick: RoutePick | null) => {
    setTouched((prev) => new Set(prev).add(agent));
    setPicks((prev) => {
      const n = { ...prev };
      if (pick && pick.model.trim()) n[agent] = pick; else delete n[agent];
      return n;
    });
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const payload: Record<string, ModelOverrideValue> = {};
      for (const agent of new Set([...Object.keys(raw), ...Object.keys(picks)])) {
        if (!touched.has(agent)) {
          if (raw[agent] !== undefined) payload[agent] = raw[agent]!;
          continue;
        }
        const p = picks[agent];
        if (!p || !p.model.trim()) continue;
        // 默认服务商只存模型 id（旧形态，处处兼容）；别家服务商存 { model, service }。
        payload[agent] = !p.service || p.service === defaultService
          ? p.model.trim()
          : { model: p.model.trim(), service: p.service };
      }
      await saveModelOverrides(payload);
      setRaw(payload);
      setTouched(new Set());
      setNotice("模型路由已保存");
      setTimeout(() => setNotice(null), 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="st-loading"><Loader2 size={20} className="spin" /> 读取模型路由…</div>;

  const configured = Object.values(picks).filter((v) => v.model.trim()).length;
  const known = new Set(groups.flatMap((g) => g.models.map((m) => encodePick({ service: g.service === defaultService ? null : g.service, model: m.id }))));
  const labelOf = (service: string | null) => service ? (groups.find((g) => g.service === service)?.label ?? service) : "默认服务商";

  return (
    <div className="st-routing">
      {error && <div className="st-error"><AlertCircle size={14} /> {error}</div>}
      {notice && <div className="st-notice"><Check size={14} /> {notice}</div>}

      <section className="st-card">
        <header className="st-card-head">
          <Route size={15} /> Agent 模型路由
          <span className="st-card-count">{configured} / {purposes.length} 已指定</span>
        </header>
        <p className="st-routing-hint">
          不指定就用全局默认模型（当前 <code>{defaultService ?? "?"} / {defaultModel ?? "未设置"}</code>）。
          下拉列出<b>所有已接入服务商</b>的模型：选了别家（中转站、OpenRouter…）会连同服务商一起保存，请求走那家的端点与 Key。
          贵模型写正文、便宜模型审稿，能省不少额度。
          <b>建书架构师和执笔师别用弱模型</b>——它们要一次写全结构化设定，弱模型经常漏 section。
          {groups.length === 0 && <><br /><b>没有拿到任何服务商的模型列表</b>：先到「模型配置」填 Key 并测通，再回来选。</>}
        </p>

        <div className="st-routing-list">
          {purposes.map((a) => {
            const pick = picks[a.id] ?? null;
            const encoded = pick ? encodePick({ service: pick.service === defaultService ? null : pick.service, model: pick.model }) : "";
            const inList = encoded ? known.has(encoded) : true;
            return (
              <div key={a.id} className={`st-routing-row ${a.needsStrong ? "is-key" : ""}`}>
                <div className="st-routing-agent">
                  <span className="st-routing-name">
                    {a.label}
                    {a.needsStrong && <Zap size={11} className="st-routing-zap" />}
                  </span>
                  <span className="st-routing-desc">{a.description}</span>
                  <code className="st-routing-id">{a.id}</code>
                </div>
                <div className="st-routing-pick">
                  {groups.length > 0 ? (
                    <div>
                      <select
                        value={inList ? encoded : "__custom__"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__custom__") return;
                          setPick(a.id, v ? decodePick(v) : null);
                        }}
                      >
                        <option value="">默认模型{defaultModel ? `（${defaultModel}）` : ""}</option>
                        {groups.map((g) => (
                          <optgroup key={g.service} label={`${g.label}${g.service === defaultService ? "（默认）" : ""}`}>
                            {g.models.map((m) => {
                              const val = encodePick({ service: g.service === defaultService ? null : g.service, model: m.id });
                              return <option key={val} value={val}>{m.name || m.id}</option>;
                            })}
                          </optgroup>
                        ))}
                        {!inList && pick && (
                          <option value="__custom__">{pick.model}（{labelOf(pick.service)}，不在列表）</option>
                        )}
                      </select>
                      {pick?.service && pick.service !== defaultService && (
                        <div className="st-routing-svc">via {labelOf(pick.service)} · {pick.service}</div>
                      )}
                    </div>
                  ) : (
                    <input
                      value={pick?.model ?? ""}
                      onChange={(e) => setPick(a.id, { service: null, model: e.target.value })}
                      placeholder="模型 id（留空=默认）"
                      spellCheck={false}
                    />
                  )}
                  {pick && (
                    <button
                      className="st-icon-btn"
                      title="清除"
                      onClick={() => setPick(a.id, null)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="st-card-actions">
          <button className="st-btn is-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={13} className="spin" /> : null} 保存路由
          </button>
        </div>
      </section>

    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   账号会员 —— 只做授权登录
   ══════════════════════════════════════════════════════════════════ */
/**
 * 产品规范：本端不做登录/注册表单，账号体系在中转站（OpenSkoob）。
 * 唯一登录方式是 OAuth 授权跳转；注册也在中转站完成（未注册用户
 * 走授权时会自然落到它的注册页）。
 */
function AccountTab() {
  const m = useMembership();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 授权回跳：读一次 ?oauth=success|error 并清掉，再刷新会员状态
  useEffect(() => {
    const result = consumeOAuthResult();
    if (!result) return;
    if (result.ok) {
      setNotice("授权成功");
      void m.refresh();
      setTimeout(() => setNotice(null), 3000);
    } else {
      setError(oauthReasonText(result.reason));
    }
    // 只在挂载时消费一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogout = async () => {
    setBusy(true);
    try { await logout(); await m.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "登出失败"); }
    finally { setBusy(false); }
  };

  if (m.loading) {
    return <div className="st-loading"><Loader2 size={20} className="spin" /> 读取账号状态…</div>;
  }

  return (
    <div className="st-account">
      <section className="st-card">
        <header className="st-card-head">
          {m.isMember ? <Crown size={15} className="st-crown" /> : <User size={15} />}
          {m.loggedIn ? (m.user?.email ?? m.user?.username ?? "已登录") : "未登录"}
        </header>

        {error && <div className="st-error"><AlertCircle size={14} /> {error}</div>}
        {notice && <div className="st-notice"><Check size={14} /> {notice}</div>}

        {m.loggedIn ? (
          <>
            <div className="st-member-row">
              {m.isMember ? (
                <span className="st-tag is-member"><Crown size={12} /> {m.plan ?? "会员"}</span>
              ) : (
                <span className="st-tag">未开通会员</span>
              )}
              {m.expiresAt && <span className="st-member-exp">到期 {m.expiresAt.slice(0, 10)}</span>}
            </div>
            <div className="st-card-actions">
              {!m.isMember && (
                // 走站内承接页选套餐，不直接跳收银台
                <NavLink className="st-btn is-primary" to="/pricing">
                  <Crown size={13} /> 查看会员套餐
                </NavLink>
              )}
              <button className="st-btn" onClick={() => void m.refresh()}>
                <RefreshCw size={13} /> 刷新状态
              </button>
              <button className="st-btn" onClick={() => void doLogout()} disabled={busy}>
                <LogOut size={13} /> 退出登录
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="st-auth-note">
              账号、订阅与支付都在 <b>OpenSkoob 中转站</b> 完成，这里只做授权。
              点下面的按钮会跳转到中转站，<b>没有账号会直接落到注册页</b>，注册完成后自动回来。
            </p>
            <div className="st-card-actions">
              <button className="st-btn is-primary" onClick={() => startOAuthLogin()}>
                <LogIn size={13} /> 授权登录 <ExternalLink size={11} />
              </button>
              <button className="st-btn" onClick={() => openRelay(m.sub2apiUrl, "register")}>
                去注册 <ExternalLink size={11} />
              </button>
            </div>
          </>
        )}
      </section>

      <section className="st-card">
        <header className="st-card-head">会员能解锁什么</header>
        <ul className="st-perks">
          <li>
            <b>世界模拟引擎</b>
            <span>建书先跑天衍 72 轮智能体仿真 + 知识图谱，六步每步消费推演产物</span>
          </li>
          <li>
            <b>阶梯仿真</b>
            <span>世界观 24 轮 / 大纲 48 轮 / 每卷 24 轮 / 每章 6 轮场景预演</span>
          </li>
          <li>
            <b>快速直出</b>
            <span>普通用户可用：六师完成意图卡、大纲到正文的完整编排，不调用天衍仿真</span>
          </li>
        </ul>
      </section>
      <section className="st-card"><header className="st-card-head"><Bot size={15} />我的智能体 · 账号基础权益</header>
        <p className="st-auth-note">每个账号都有一个专属创作化身，可以设置名字、简介、性格与剧情引导风格。</p>
        <div className="st-card-actions"><NavLink className="st-btn is-primary" to="/settings/agent">设置我的智能体</NavLink></div>
      </section>

    </div>
  );
}
