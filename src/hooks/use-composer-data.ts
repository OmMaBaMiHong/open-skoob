import { useCloudAccess } from "../cloud-access";
import { readAuth } from "../lib/auth-storage";
/**
 * Composer 需要的全部数据，一次拉齐。
 *
 * 输入框是**统一入口**：首页、对话页、引导向导右栏、重铸反馈……凡是与智能体
 * 交互的地方都用同一个 Composer，那它要的数据（技能 / 智能体 / 流派模板 / 当前
 * 模型）也不该由每个页面各拉一遍。集中在这里，页面只管用。
 *
 * 顺带统一了两条语义：
 *   - 已安装技能（技能栏点 ＋ 的）自动预置进编队；
 *   - 任一接口失败只让那一项为空，不影响输入框本身可用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSkills, fetchGraphAgents, fetchGenres, fetchAgentTemplates, fetchProjectLlm,
  fetchServices, fetchServiceModels, fetchDefaultModel,
  type SkillInfo, type GraphAgent, type GenreInfo, type AgentTemplateInfo, type ProjectLlmInfo,
} from "../lib/api";
import {
  readModelChoice, writeModelChoice, subscribeModelChoice,
} from "../lib/model-choice";
import { useInstalledSkills } from "./use-installed-skills";
import { EMPTY_SUMMON, type Summoned } from "../types/composer";

/**
 * 可选模型（按服务分组）。
 *
 * 后端 `resolveAgentLLM` 要 **service + model 成对**才认前端的选择——只传 model
 * 会被忽略、回落到项目默认。所以选中项必须同时记住服务。
 */
export interface ModelChoice {
  readonly service: string;
  readonly serviceLabel: string;
  readonly id: string;
  readonly name: string;
}

export interface ComposerData {
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly agents: ReadonlyArray<GraphAgent>;
  readonly genres: ReadonlyArray<GenreInfo>;
  readonly templates: ReadonlyArray<AgentTemplateInfo>;
  readonly llm: ProjectLlmInfo | null;
  /** 已连接服务下的全部可选模型。 */
  readonly models: ReadonlyArray<ModelChoice>;
  /** 当前选中的模型（优先使用态选择；没选过/已失效回落项目默认模型）。 */
  readonly selected: ModelChoice | null;
  /** 使用态选择失效（服务断开/模型下线）回落默认时给用户的提示。 */
  readonly modelNotice: string | null;
  readonly selectModel: (m: ModelChoice) => void;
  /** 已安装技能 id（技能栏点 ＋ 装的）。 */
  readonly installed: ReadonlyArray<string>;
}

export function useComposerData(opts: { graphId?: string; preserveExplicitModel?: boolean } = {}): ComposerData {
  const { graphId, preserveExplicitModel = false } = opts;
  const cloud = useCloudAccess();
  const [skills, setSkills] = useState<ReadonlyArray<SkillInfo>>([]);
  const [agents, setAgents] = useState<ReadonlyArray<GraphAgent>>([]);
  const [genres, setGenres] = useState<ReadonlyArray<GenreInfo>>([]);
  const [templates, setTemplates] = useState<ReadonlyArray<AgentTemplateInfo>>([]);
  const [llm, setLlm] = useState<ProjectLlmInfo | null>(null);
  const [models, setModels] = useState<ReadonlyArray<ModelChoice>>([]);
  const [selected, setSelected] = useState<ModelChoice | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const { installed } = useInstalledSkills();

  /**
   * 选中项解析：使用态选择（localStorage）优先，其次项目默认模型。
   *
   * 存着的选择不在已连接服务清单里（服务断开/模型下线，免费渠道常有）：
   * 界面与后续请求回落默认，但**不删存储**——服务恢复后选择自动生效；
   * 提示明说，别让用户以为选的模型还在用。各实例用同一份输入独立推导，
   * 结论必然一致（工作台+六师随行两份 composer 提示同步）。
   */
  const resolveRef = useRef<{
    flat: ReadonlyArray<ModelChoice>;
    def: { service: string | null; defaultModel: string | null };
  }>({ flat: [], def: { service: null, defaultModel: null } });

  const resolveSelected = useCallback(() => {
    const { flat, def } = resolveRef.current;
    const stored = readModelChoice();
    if (stored) {
      const hit = flat.find((m) => m.id === stored.id && ((!stored.service && !preserveExplicitModel) || m.service === stored.service));
      if (hit) {
        setSelected(hit);
        setModelNotice(null);
        return;
      }
      if (preserveExplicitModel) {
        setSelected(stored);
        setModelNotice(`已选模型「${stored.name}」当前未确认可用，请检查服务配置或主动选择其他模型`);
        return;
      }
      setModelNotice(`已选模型「${stored.name}」当前不可用，已回落默认模型`);
    } else {
      setModelNotice(null);
    }
    if (def.defaultModel) {
      const hit = flat.find((m) => m.id === def.defaultModel && (!def.service || m.service === def.service));
      setSelected(hit ?? {
        service: def.service ?? "", serviceLabel: def.service ?? "",
        id: def.defaultModel, name: def.defaultModel,
      });
    } else {
      setSelected(null);
    }
  }, [preserveExplicitModel]);

  // 别的实例/别的标签页改了使用态选择：就地重解析，本页下拉立即跟上。
  useEffect(() => subscribeModelChoice(resolveSelected), [resolveSelected]);

  /**
   * 拉取已连接服务下的模型清单。
   *
   * 只查 `connected` 的服务：没配 API key 的服务列出来也用不了，反而让菜单变长。
   * 单个服务拉失败（key 失效/网络）不影响其他服务。
   */
  useEffect(() => {
    void (async () => {
      if (!readAuth()) return;
      const [list, def] = await Promise.all([
        fetchServices().catch(() => []),
        fetchDefaultModel().catch(() => ({ service: null, defaultModel: null })),
      ]);
      const connected = list.filter((s) => s.connected);
      const groups = await Promise.all(connected.map(async (svc) => {
        const ms = await fetchServiceModels(svc.service).catch(() => []);
        return ms.map((m) => ({
          service: svc.service, serviceLabel: svc.label || svc.service,
          id: m.id, name: m.name || m.id,
        }));
      }));
      const flat = groups.flat();
      resolveRef.current = { flat, def };
      setModels(flat);
      // 默认选中项目默认模型；它可能不在动态列表里（用户手填的），那就按配置造一条。
      if (def.defaultModel) {
        const hit = flat.find((m) => m.id === def.defaultModel && (!def.service || m.service === def.service));
        setSelected(hit ?? {
          service: def.service ?? "", serviceLabel: def.service ?? "",
          id: def.defaultModel, name: def.defaultModel,
        });
      }
      // 使用态选择最后拍板（可能覆盖上面的默认，也可能触发回落提示）。
      resolveSelected();
    })();
  }, [resolveSelected, cloud.ready]);

  useEffect(() => {
    let alive = true;
    if (!cloud.ready) { setSkills(previous => previous.filter(x => !x.id.startsWith("official:"))); setGenres(previous => previous.filter(x => !x.id.startsWith("official:"))); setTemplates(previous => previous.filter(x => !x.id.startsWith("official:"))); }
    void Promise.all([
      fetchSkills().catch(() => []),
      fetchGenres().catch(() => []),
      fetchAgentTemplates().catch(() => []),
      readAuth() ? fetchProjectLlm().catch(() => null) : Promise.resolve(null),
    ]).then(([sk, ge, tp, lm]) => { if (alive) { setSkills(cloud.ready ? sk : sk.filter(x => !x.id.startsWith("official:"))); setGenres(cloud.ready ? ge : ge.filter(x => !x.id.startsWith("official:"))); setTemplates(cloud.ready ? tp : tp.filter(x => !x.id.startsWith("official:"))); setLlm(lm); } });
    return () => { alive = false; };
  }, [cloud.ready]);

  /**
   * 智能体单独拉：本书优先，**本书为空时回落全量**。
   *
   * 智能体是跨书永久资产。新书刚建、世界观还没确认时本书一个都没有，这时候
   * 应该让用户能借用旧书沉淀下来的角色和势力，而不是给他一个空列表。
   */
  useEffect(() => {
    void fetchGraphAgents(graphId ? { graphId, limit: 500 } : { limit: 500 })
      .then(async (list) => (graphId && list.length === 0 ? fetchGraphAgents({ limit: 500 }) : list))
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [graphId]);

  /**
   * 切换使用态模型：先落 localStorage 再 setState——写库会广播，
   * 同页其他 useComposerData 实例（工作台+六师随行）立刻同步。
   */
  const selectModel = useCallback((m: ModelChoice) => {
    writeModelChoice({ service: m.service, serviceLabel: m.serviceLabel, id: m.id, name: m.name });
    setSelected(m);
    setModelNotice(null);
  }, []);

  return { skills, agents, genres, templates, llm, installed, models, selected, modelNotice, selectModel };
}

/**
 * 把已安装技能补进编队。
 *
 * 只补不覆盖 —— 用户本轮手动加的技能不会被冲掉。返回新对象才触发更新，
 * 否则原样返回，避免无谓重渲染。
 */
export function withInstalledSkills(
  prev: Summoned,
  skills: ReadonlyArray<SkillInfo>,
  installed: ReadonlyArray<string>,
): Summoned {
  if (installed.length === 0 || skills.length === 0) return prev;
  const have = new Set(prev.skills.map((s) => s.id));
  const add = skills.filter((s) => installed.includes(s.id) && !have.has(s.id));
  return add.length === 0 ? prev : { ...prev, skills: [...prev.skills, ...add] };
}

export { EMPTY_SUMMON };
