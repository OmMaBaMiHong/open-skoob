import { fetchJson } from "./api";
export interface PublicPersona {
  id: string; engine: "tianmo" | "tianyan" | "tiangong" | "tianwang" | "zhushen"; name: string; bio: string;
  avatarUrl: string; welcome: string; starters: string[]; enabled: boolean;
}
export const ENGINE_NAMES = { tianmo: "天魔 · 灵感", tianyan: "天衍 · 推演", tiangong: "天工 · 文字与图片", tianwang: "天王 · 拆书", zhushen: "主神 · 综合助手" };
export const fetchOfficialPersonas = () => fetchJson<{ personas: PublicPersona[] }>("/official-personas");
