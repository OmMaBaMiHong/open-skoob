import { cloudOptions } from './cloud.mjs';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const presets = [
  { service: 'gaotk', label: 'OpenSkoob 中转站', baseUrl: 'https://lai.gaotk.com/v1', group: 'aggregator' },
  { service: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', group: 'overseas' },
  { service: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', group: 'china' },
  { service: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', group: 'china' },
];
export const serviceId = entry => entry.service === 'custom' ? `custom:${entry.name}` : entry.service;
export function config(store) { return store.get('settings', 'models', { services: [], service: null, defaultModel: null, configSource: 'local' }); }
export const canonicalService = (store, id) => store.get('settings', 'serviceAliases', {})[id] || id;
export function isOfficialService(store, service, input = {}) {
  service = canonicalService(store, service);
  const entry = config(store).services.find(e => serviceId(e) === service);
  const base = input.baseUrl || entry?.baseUrl || presets.find(e => e.service === service)?.baseUrl;
  return service === 'gaotk' || Boolean(base && ['lai.gaotk.com', 'gaotk.com'].includes(new URL(endpoint(base)).hostname));
}
const LOCAL_FREE_BASE = 'https://api.kilo.ai/api/openrouter';
const isFreeModel = id => id.endsWith(':free') || id === 'openrouter/free';
async function officialModels(store, key, signal, selectedModel) {
  if (!key) throw new ApiError(403, 'FREE_KEY_REQUIRED', '请先领取并配置官方 Key，再使用 Free 套餐的模型权益。');
  const cloud = cloudOptions(store);
  const response = await fetch(endpoint(cloud.baseUrl) + '/api/v1/open/catalog/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(20000)]), redirect: 'error' });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body?.error?.code || 'FREE_VERIFY_FAILED', body?.error?.message || '官方模型权益校验失败，请重新验证 Key。');
  if (!Array.isArray(body.data)) throw new ApiError(502, 'MODEL_CATALOG_INVALID', '官方模型目录响应无效');
  const allowed = body.data.filter(m => typeof m.id === 'string').map(m => ({ id: m.id, name: m.name || m.id }));
  if (selectedModel && !isFreeModel(selectedModel) || !allowed.some(m => isFreeModel(m.id))) return allowed;
  // Public anonymous upstream: the official Key and user prompts never enter this lookup.
  const upstream = await fetch(`${LOCAL_FREE_BASE}/models`, { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(20000)]), redirect: 'error' });
  if (!upstream.ok) throw new ApiError(503, 'LOCAL_FREE_UNAVAILABLE', '本机暂时无法连接免费模型目录，请检查网络后重试。未切换中转站。');
  const catalog = await upstream.json();
  if (!Array.isArray(catalog.data)) throw new ApiError(502, 'MODEL_CATALOG_INVALID', '免费模型目录响应无效');
  const zero = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number(value) === 0;
  const free = new Map(catalog.data.filter(m => typeof m.id === 'string' && isFreeModel(m.id)
    && m.pricing && zero(m.pricing.prompt) && zero(m.pricing.completion)
    && Object.entries(m.pricing).every(([field, value]) => field === 'discount' || zero(value))).map(m => [m.id, m]));
  return allowed.filter(m => !isFreeModel(m.id) || free.has(m.id)).map(m => free.has(m.id) ? { id: m.id, name: `${free.get(m.id).name || m.name} · Free · 本机直连` } : m);
}
export function endpoint(value) {
  let u; try { u = new URL(value); } catch { throw new ApiError(400, 'INVALID_BASE_URL', '请填写完整的模型服务 Base URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new ApiError(400, 'INVALID_BASE_URL', '模型服务地址不能包含凭据、查询参数或片段');
  return u.href.replace(/\/$/, '');
}
export function resolveModel(store, selected = {}, purpose) {
  const cfg = config(store); const overrides = store.get('settings', 'overrides', {});
  const override = purpose ? overrides[purpose] : null;
  // Explicit per-request selection wins. Never swap providers or create a gateway key.
  const service = canonicalService(store, selected.service || (override && typeof override === 'object' ? override.service : null) || cfg.service);
  const model = selected.model || (typeof override === 'string' ? override : override?.model) || cfg.defaultModel;
  const entry = cfg.services.find(e => serviceId(e) === service);
  const preset = presets.find(e => e.service === service);
  if (!service || !model || (!entry && !preset)) throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '请先在设置中配置服务商并选择模型');
  const baseUrl = endpoint(entry?.baseUrl || preset?.baseUrl);
  const key = store.secret(service);
  if (!key && !entry?.allowNoKey) throw new ApiError(400, 'MODEL_KEY_MISSING', '所选服务商尚未配置 API Key');
  return { ...entry, service, model, baseUrl, key };
}
export async function listModels(store, service, input = {}, signal) {
  service = canonicalService(store, service);
  const cfg = config(store); const entry = cfg.services.find(e => serviceId(e) === service); const preset = presets.find(e => e.service === service);
  const baseUrl = endpoint(input.baseUrl || entry?.baseUrl || preset?.baseUrl);
  const key = input.apiKey || store.secret(service);
  if (isOfficialService(store, service, input)) return officialModels(store, key, signal);
  const response = await fetch(`${baseUrl}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(20000)]), redirect: 'error' });
  if (!response.ok) throw new ApiError(502, 'MODEL_CATALOG_FAILED', `模型列表请求失败（HTTP ${response.status}），请检查地址和 Key`);
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new ApiError(502, 'MODEL_CATALOG_INVALID', '服务商未返回兼容的模型列表，请确认 Base URL 指向 OpenAI 兼容 API');
  return body.data.filter(m => typeof m.id === 'string').map(m => ({ id: m.id, name: m.name || m.id }));
}
export async function complete(store, selected, messages, { signal, onDelta, purpose, json = false } = {}) {
  const m = resolveModel(store, selected, purpose);
  if (isOfficialService(store, m.service)) {
    const allowed = await officialModels(store, m.key, signal, m.model);
    if (!allowed.some(model => model.id === m.model)) throw new ApiError(403, 'MODEL_NOT_AUTHORIZED', '当前 Key 未授权所选模型，请刷新模型列表重新选择。');
    if (isFreeModel(m.model)) {
      // Node runs on the deployment machine. Never send the platform Key to Kilo.
      m.baseUrl = LOCAL_FREE_BASE; m.key = ''; m.apiFormat = 'chat';
    }
  }
  const responses = m.apiFormat === 'responses';
  const stream = m.stream !== false && Boolean(onDelta);
  const body = responses ? { model: m.model, input: messages, stream, store: false } : { model: m.model, messages, stream };
  if (m.temperature !== undefined) body.temperature = m.temperature;
  // JSON is requested in the public task prompt; avoid vendor-specific structured-output fallbacks.
  const response = await fetch(`${m.baseUrl}/${responses ? 'responses' : 'chat/completions'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(m.key ? { Authorization: `Bearer ${m.key}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(300000)]), redirect: 'error',
  });
  if (!response.ok) {
    if (m.baseUrl === LOCAL_FREE_BASE && response.status === 429) throw new ApiError(429, 'LOCAL_FREE_RATE_LIMITED', '本机出口 IP 的免费模型额度暂时受限，请稍后重试；未使用代理池或切换付费模型。');
    throw new ApiError(502, 'MODEL_REQUEST_FAILED', `所选模型请求失败（HTTP ${response.status}），未切换模型或中转站`);
  }
  let text = '';
  if (!stream || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const result = await response.json();
    if (result.status === 'incomplete' || result.choices?.[0]?.finish_reason === 'length') throw new ApiError(502, 'MODEL_OUTPUT_TRUNCATED', '模型达到输出上限，内容未完成；请调整服务商限制后重试');
    text = responses ? result.output?.flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('') ?? result.output_text ?? '' : result.choices?.[0]?.message?.content ?? '';
    if (onDelta && text) onDelta(text);
  } else {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let finished = false;
    function consume(line) {
      line = line.trim(); if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim(); if (data === '[DONE]') { finished = true; return; }
      let event; try { event = JSON.parse(data); } catch { throw new ApiError(502, 'MODEL_STREAM_INVALID', '模型流式响应格式损坏'); }
      if (event.error || event.type === 'response.failed') throw new ApiError(502, 'MODEL_STREAM_FAILED', '模型流式响应中断，请检查服务商记录后重试');
      if (event.type === 'response.incomplete' || event.response?.status === 'incomplete' || event.choices?.[0]?.finish_reason === 'length') throw new ApiError(502, 'MODEL_OUTPUT_TRUNCATED', '模型达到输出上限，内容未完成；请调整服务商限制后重试');
      if (event.type === 'response.completed' || event.choices?.[0]?.finish_reason === 'stop') finished = true;
      const delta = responses ? event.type === 'response.output_text.delta' ? event.delta : '' : event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) { text += delta; onDelta?.(delta); }
    }
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        buffer += decoder.decode(item.value, { stream: true }); let end;
        while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0,end)); buffer = buffer.slice(end+1); }
      }
      buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
      if (!finished) throw new ApiError(502, 'MODEL_STREAM_INCOMPLETE', '模型连接提前结束，正文未标记完成；请确认服务商状态后重试');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  if (typeof text !== 'string' || !text.trim()) throw new ApiError(502, 'MODEL_EMPTY_RESPONSE', '所选模型未返回正文');
  if (!json) return text;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { const value = JSON.parse(cleaned); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new ApiError(502, 'MODEL_INVALID_JSON', '模型未返回有效 JSON；已有内容保留，请重试本步或选择支持结构化输出的模型'); }
}
