import { summarizeWorkflowError } from "../lib/workflow-error";

export function WorkflowError({ error }: { readonly error: string }) {
  const summary = summarizeWorkflowError(error);
  return <>
    <div className="wb-failed-msg">{summary}</div>
    {summary !== error && <details className="wb-error-details">
      <summary>查看错误详情</summary>
      <pre>{error}</pre>
    </details>}
  </>;
}
