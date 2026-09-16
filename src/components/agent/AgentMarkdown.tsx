import { createElement, memo, type ReactNode } from "react";
import { marked, type Token } from "marked";

function safeLink(href: string) {
  try { const url = new URL(href, window.location.href); return ["http:", "https:"].includes(url.protocol) ? href : undefined; }
  catch { return undefined; }
}
function inline(tokens: Token[] = []): ReactNode[] {
  return tokens.map((token, index) => {
    const children = "tokens" in token && token.tokens ? inline(token.tokens) : "text" in token ? token.text : token.raw;
    switch (token.type) {
      case "strong": return <strong key={index}>{children}</strong>;
      case "em": return <em key={index}>{children}</em>;
      case "del": return <del key={index}>{children}</del>;
      case "codespan": return <code key={index}>{token.text}</code>;
      case "br": return <br key={index} />;
      case "link": return safeLink(token.href) ? <a key={index} href={safeLink(token.href)} target="_blank" rel="noopener noreferrer">{children}</a> : <span key={index}>{children}</span>;
      // Model-authored image links never trigger background external requests.
      // Actual image artifacts use the authenticated resource viewer.
      case "image": return safeLink(token.href) ? <a key={index} href={safeLink(token.href)} target="_blank" rel="noopener noreferrer">{token.text || "图片链接"}</a> : token.text;
      default: return <span key={index}>{children}</span>;
    }
  });
}
function blocks(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "space": return null;
      case "heading": return createElement(`h${Math.min(token.depth + 1, 6)}`, { key: index }, inline(token.tokens));
      case "paragraph": return <p key={index}>{inline(token.tokens)}</p>;
      case "text": return <span key={index}>{token.tokens ? inline(token.tokens) : token.text}</span>;
      case "code": return <pre key={index}><code>{token.text}</code></pre>;
      case "blockquote": return <blockquote key={index}>{blocks(token.tokens ?? [])}</blockquote>;
      case "hr": return <hr key={index} />;
      case "list": {
        const items = token.items.map((item: { tokens: Token[]; task?: boolean; checked?: boolean }, position: number) => <li key={position}>{item.task && <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? "已完成" : "未完成"} />}{blocks(item.tokens)}</li>);
        return token.ordered ? <ol key={index} start={token.start || 1}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
      case "table": return <div className="ga-markdown-table" key={index}><table><thead><tr>{token.header.map((cell: { tokens: Token[] }, column: number) => <th key={column}>{inline(cell.tokens)}</th>)}</tr></thead>
        <tbody>{token.rows.map((row: { tokens: Token[] }[], position: number) => <tr key={position}>{row.map((cell, column) => <td key={column}>{inline(cell.tokens)}</td>)}</tr>)}</tbody></table></div>;
      // Raw HTML is displayed as text, never passed to innerHTML.
      default: return <span key={index}>{token.raw}</span>;
    }
  });
}
export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  return <div className="ga-markdown">{blocks(marked.lexer(text, { gfm: true, breaks: true }))}</div>;
});
