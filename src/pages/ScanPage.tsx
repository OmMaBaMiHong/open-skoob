import { Link } from "react-router-dom";
import { ArrowLeft, Radar } from "lucide-react";
import { ScanPanel } from "../components/ScanPanel";

/** 兼容原有 /scan 地址，与创作首页共用同一套扫榜交互。 */
export function ScanPage() {
  return <div className="page">
    <header className="page-top">
      <h1 className="page-title"><Radar size={16} className="scan-title-icon" /> 天魔扫榜</h1>
        <Link className="scan-back" to="/create?tianmo=scan"><ArrowLeft size={14} /> 返回首页扫榜</Link>
    </header>
    <div className="page-body scan-body"><ScanPanel /></div>
  </div>;
}
