/**
 * RoleProfile —— 智能体档案（角色卡）。
 *
 * 大纲步的 `roles[]` 每一项本来就是一份**完整档案**：
 *   { name, tier, type, persona, appearance, bio, goal, conflict,
 *     abilities, relationships, growth, plot_weight, flow_tags[], content }
 * 之前 UI 只渲染了 `name` —— 一个点不开、没有身份标签的死标题，
 * 后端辛苦生成的 9 个字段全被前端丢掉了。
 *
 * 这里把档案摊开：
 *   - 芯片带**分类图标 + 中文分类标签**（主角型 / 反派型 / 势力代表型…），
 *     一眼看得出谁是主角；
 *   - 点芯片开档案弹窗，逐字段展示，并可展开天衍写的 md 全文。
 *
 * 分类映射走 types/experts 的 {@link agentTypeOf}（后端 AGENT_TYPE_DEFS 的前端镜像），
 * 不在这里另立一套判断。
 */
import { useState } from "react";
import { DetailModal } from "./GenreTeamDetail";
import { toRoleView, hasRoleDetail } from "../lib/role-profile";
import { agentTypeOf, tierLabel } from "../types/experts";

type Rec = Readonly<Record<string, unknown>>;

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * 一枚可点的角色芯片：分类图标 + 名字 + 身份标签。
 * 没档案的（只有名字）退化成静态芯片，不给假的可点手势。
 */
export function RoleChip({
  role, onOpen,
}: { readonly role: Rec; readonly onOpen: (role: Rec) => void }) {
  const view = toRoleView(role);
  const st = agentTypeOf(view.type);
  const lv = tierLabel(view.tier);
  const openable = hasRoleDetail(view);
  const badge = st.typeId ? st.label : lv ? `${lv}角色` : "";
  const body = (
    <>
      <span className="so-role-ico">{st.icon}</span>
      <span className="so-role-name">{view.name}</span>
      {badge && <span className="so-role-tag">{badge}</span>}
    </>
  );
  if (!openable) return <span className={`so-role is-${st.tone} is-flat`}>{body}</span>;
  return (
    <button
      type="button"
      className={`so-role is-${st.tone}`}
      title={`查看《${view.name}》完整档案`}
      onClick={() => onOpen(role)}
    >
      {body}
    </button>
  );
}

/** 一组角色芯片 + 档案弹窗（弹窗状态自持，调用方不用管）。 */
export function RoleChips({ roles }: { readonly roles: ReadonlyArray<Rec> }) {
  const [open, setOpen] = useState<Rec | null>(null);
  return (
    <>
      <div className="so-roles">
        {roles.map((r, i) => (
          <RoleChip key={`${s(r.name)}-${i}`} role={r} onOpen={setOpen} />
        ))}
      </div>
      {open && <RoleProfileModal role={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** 角色档案弹窗：分类/层级/权重/流派标签 + 逐字段档案 + md 全文。 */
export function RoleProfileModal({
  role, onClose,
}: { readonly role: Rec; readonly onClose: () => void }) {
  const view = toRoleView(role);
  const st = agentTypeOf(view.type);
  const lv = tierLabel(view.tier);
  const [showRaw, setShowRaw] = useState(false);
  return (
    <DetailModal onClose={onClose}>
      <div className="wb2-md-h">
        <span className={`wb2-avatar is-lg is-${st.tone}`}>{st.icon}</span>
        <div>
          <h2>{view.name}</h2>
          <div className="wb2-md-from">智能体档案 · 天衍推演产物</div>
        </div>
      </div>
      <div className="wb2-md-tags">
        {st.typeId && <span className={`wb2-tag is-${st.tone}`}>{st.emoji} {st.label}</span>}
        {lv && <span className="wb2-tag is-lvl">{lv}角色</span>}
        {view.weight > 0 && <span className="wb2-tag is-w">剧情参与 {view.weight}</span>}
        {view.flowTags.slice(0, 8).map((t) => (
          <span key={t} className="wb2-tag is-flow">{t}</span>
        ))}
      </div>
      {st.typeId && <div className="wb2-md-behavior">推演中的行为：{st.behavior}</div>}
      {view.bio && <p className="wb2-md-bio">{view.bio}</p>}
      {view.facets.length > 0 ? (
        <dl className="wb2-md-facets">
          {view.facets.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      ) : (
        <div className="wb2-md-thin">
          这个智能体只生成了名字，目标/冲突/能力等字段还是空的 —— 重铸大纲可以补全。
        </div>
      )}
      {view.content && (
        <div className="wb2-md-body">
          <button className="wb2-md-toggle" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "收起" : "查看"} 档案全文
          </button>
          {showRaw && <pre className="wb2-md-pre">{view.content}</pre>}
        </div>
      )}
    </DetailModal>
  );
}
