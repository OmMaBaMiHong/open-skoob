import type { AgentProgress } from "../lib/agent-progress";
export function AgentActivity({ progress, busy = false }: { progress: AgentProgress; busy?: boolean }) {
  if (!busy && progress.items.length === 0) return null;
  const running = busy || progress.active;
  return <details className="agent-activity">
    <summary>{running ? "思考与执行中" : "查看执行过程"}<span>{progress.items.length ? ` · ${progress.items.length} 项` : " · 等待任务开始"}</span></summary>
    <p>展示当前步骤和执行摘要。</p>
    <ol>{progress.items.length ? progress.items.map(item => <li key={item.id} data-status={item.status}>
      <span aria-label={item.status === "running" ? "进行中" : item.status === "error" ? "未完成" : "已完成"}>{item.status === "running" ? "◌" : item.status === "error" ? "!" : "✓"}</span> {item.label}
    </li>) : <li>请求已提交，等待后台处理。</li>}</ol>
  </details>;
}
