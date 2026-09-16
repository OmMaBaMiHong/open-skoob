import { createContext, useContext } from "react";
export type CloudAccess = { ready: boolean; message: string; connect: () => void };
export const CloudAccessContext = createContext<CloudAccess>({ ready: false, message: "领取 Free Key 后，即可浏览官方云端内容。", connect: () => {} });
export const useCloudAccess = () => useContext(CloudAccessContext);
export function CloudAccessPrompt() {
  const cloud = useCloudAccess();
  return <section className="cloud-status" aria-label="官方免费内容"><h3>连接官方，免费发现故事灵感</h3><p>{cloud.message}</p><p>验证 Free Key 后查看天魔脑洞、热点和官方模板；付费引擎按账号套餐开放。</p><button className="btn" onClick={cloud.connect}>连接官方，领取 Free Key</button></section>;
}
