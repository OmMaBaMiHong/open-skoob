import { createContext, useContext } from "react";
export type CloudAccess = { ready: boolean; entitlements: string[]; planName: string; message: string; connect: () => void };
export const FREE_RIGHT_LABELS: Record<string, string> = { "brainstorm.read": "AI 脑洞与配图", "hotboard.read": "热点榜单与搜索", "templates.read": "官方模板、流派与技能", "models.use": "官方模型接入（范围与额度以 Key 授权为准）" };
export const CloudAccessContext = createContext<CloudAccess>({ ready: false, entitlements: [], planName: "Free 免费套餐", message: "领取 Free Key 后，即可浏览官方云端内容。", connect: () => {} });
export const useCloudAccess = () => useContext(CloudAccessContext);
export function CloudAccessPrompt() {
  const cloud = useCloudAccess();
  return <section className="cloud-status" aria-label="官方免费内容"><h3>{cloud.ready ? "当前 Free 套餐未开放此项内容" : "连接官方，免费发现故事灵感"}</h3><p>{cloud.ready ? "实际开放内容以官方配置的套餐权益为准，本地创作仍可使用。" : cloud.message}</p><p>验证官方 Key 后按 Free 权益浏览云端内容；付费引擎按账号套餐开放。</p><button className="btn" onClick={cloud.connect}>{cloud.ready ? "查看我的 Free 权益" : "连接官方，领取 Free Key"}</button></section>;
}
