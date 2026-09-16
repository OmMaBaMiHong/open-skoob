/** 工作流错误保持原始记录，默认只展示可读摘要。兼容已持久化的旧版校验错误。 */
export function summarizeWorkflowError(error: string): string {
  if (error.includes("output failed schema validation")) {
    if (error.includes("Expected string, received array")) return "生成结果的字段格式不兼容：章节范围或势力列表返回了数组。本步尚未完成。";
    if (error.includes("10–15") || error.includes("连续覆盖")) return "生成的大纲未满足章节覆盖或小循环长度要求，本步尚未完成。请展开详情查看具体章号。";
    return "生成结果未通过结构校验，本步尚未完成。请展开详情查看需要修正的字段。";
  }
  if (error.includes("output is not valid JSON")) return "生成结果不是完整的结构化内容，本步尚未完成。";
  return error.length > 240 ? `${error.slice(0, 240)}…` : error;
}
