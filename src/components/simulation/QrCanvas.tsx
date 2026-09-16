/**
 * QrCanvas —— 分享链接的二维码。
 *
 * 画成 SVG 而不是 canvas：矢量，缩放不糊，右键就能存图。
 * 生成在**本地**完成（qrcode-generator 是个零依赖的纯算法库），
 * 链接不会为了画个码再发给任何第三方服务。
 */
import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface QrCanvasProps {
  readonly text: string;
  readonly size?: number;
}

export function QrCanvas({ text, size = 168 }: QrCanvasProps) {
  const modules = useMemo(() => {
    // typeNumber 0 = 按内容自动选版本；"M" 级容错够印在屏幕上扫。
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const dark: Array<[number, number]> = [];
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) dark.push([r, c]);
      }
    }
    return { count, dark };
  }, [text]);

  // 静区（quiet zone）留 2 格：贴边的码有些扫码器读不出来。
  const pad = 2;
  const span = modules.count + pad * 2;

  return (
    <svg
      className="qr-svg"
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="分享链接二维码"
    >
      <rect width={span} height={span} fill="#fff" />
      {modules.dark.map(([r, c]) => (
        <rect key={`${r}-${c}`} x={c + pad} y={r + pad} width={1} height={1} fill="#211B16" />
      ))}
    </svg>
  );
}
