import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import "../../styles/deconstruction-layout.css";

const STORAGE_KEY = "skoob:deconstruction-layout:v1";
const defaults = { left: 230, right: 420, leftClosed: false, rightClosed: false };
type Preferences = typeof defaults;
type Side = "left" | "right";
type Pane = "directory" | "reading" | "chat";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
function readPreferences(storageKey: string): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return {
      left: Number.isFinite(saved?.left) ? clamp(saved.left, 180, 360) : defaults.left,
      right: Number.isFinite(saved?.right) ? clamp(saved.right, 300, 640) : defaults.right,
      leftClosed: saved?.leftClosed === true, rightClosed: saved?.rightClosed === true,
    };
  } catch { return defaults; }
}

export function DeconstructionLayout({ children, contentKey, variant = "deconstruction" }: { children: ReactNode; contentKey: unknown; variant?: "deconstruction" | "workbench" }) {
  const storageKey = variant === "workbench" ? "skoob:workbench-layout:v1" : STORAGE_KEY;
  const [prefs, setPrefs] = useState(() => readPreferences(storageKey));
  const [pane, setPane] = useState<Pane>("reading");
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ side: Side; x: number; width: number } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (body.current) observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch { /* Layout still works without storage. */ } }, [prefs, storageKey]);
  useEffect(() => setPane("reading"), [contentKey]);
  // Preserve stored widths when the window shrinks; reserve room for reading first.
  const available = Math.max(0, width - 320 - 12);
  const left = prefs.leftClosed ? 0 : Math.min(prefs.left, Math.max(180, available - (prefs.rightClosed ? 0 : 300)));
  const right = prefs.rightClosed ? 0 : Math.min(prefs.right, Math.max(300, available - left));
  const maximum = (side: Side) => side === "left" ? Math.min(360, Math.max(180, available - right)) : Math.min(640, Math.max(300, available - left));
  const resize = (side: Side, value: number) => setPrefs(previous => ({ ...previous, [side]: clamp(value, side === "left" ? 180 : 300, maximum(side)) }));
  const separator = (side: Side) => <div className={`dcw-divider is-${side}`} role="separator" aria-label={side === "left" ? "调整目录宽度" : "调整助手宽度"}
    aria-orientation="vertical" aria-valuemin={side === "left" ? 180 : 300} aria-valuemax={maximum(side)} aria-valuenow={Math.round(side === "left" ? left : right)}
    tabIndex={0} title="拖动调整宽度，双击恢复默认；方向键微调"
    onDoubleClick={() => setPrefs(previous => ({ ...previous, [side]: defaults[side] }))}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = side === "left" ? left : right;
      resize(side, event.key === "Home" ? (side === "left" ? 180 : 300) : event.key === "End" ? maximum(side)
        : current + (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1));
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { side, x: event.clientX, width: side === "left" ? left : right }; setDragging(true);
    }}
    onPointerMove={event => {
      if (drag.current?.side === side) resize(side, drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1));
    }}
    onPointerUp={event => { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onPointerCancel={() => { drag.current = null; setDragging(false); }} />;
  return <>
    <div className="dcw-layout-toolbar">
      <button className="dcw-desktop-toggle" type="button" aria-expanded={!prefs.leftClosed} aria-label={prefs.leftClosed ? "展开目录" : "折叠目录"}
        onClick={() => setPrefs(previous => ({ ...previous, leftClosed: !previous.leftClosed }))}>
        {prefs.leftClosed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}目录
      </button>
      <div className="dcw-mobile-tabs" role="tablist" aria-label={variant === "workbench" ? "写书工作区" : "拆书工作区"}>
        {([['directory', '目录'], ['reading', '阅读'], ['chat', '助手']] as const).map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={pane === id} onClick={() => setPane(id)}>{label}</button>)}
      </div>
      <button className="dcw-desktop-toggle" type="button" aria-expanded={!prefs.rightClosed} aria-label={prefs.rightClosed ? "展开助手" : "折叠助手"}
        onClick={() => setPrefs(previous => ({ ...previous, rightClosed: !previous.rightClosed }))}>
        {prefs.rightClosed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}助手
      </button>
    </div>
    <div ref={body} className={`${variant === "workbench" ? "wb-body " : ""}dcw-body dcw-resizable is-mobile-${pane}${prefs.leftClosed ? " is-left-collapsed" : ""}${prefs.rightClosed ? " is-right-collapsed" : ""}${dragging ? " is-resizing" : ""}`}
      style={{ "--dcw-left": `${left}px`, "--dcw-right": `${right}px` } as CSSProperties}>
      {children}{!prefs.leftClosed && separator("left")}{!prefs.rightClosed && separator("right")}
    </div>
  </>;
}
