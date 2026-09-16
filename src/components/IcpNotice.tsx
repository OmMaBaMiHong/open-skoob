/**
 * ICP 备案信息（中国大陆网站合规要求）。
 * 工信部规定备案号必须可点击链接到 https://beian.miit.gov.cn/。
 * 备案数据：浙ICP备2026010374号-1 · 主办单位：煊光（杭州）智能科技有限公司
 * 审核通过：2026-02-25 · 网站域名：ai-ni.store
 */
export function IcpNotice({ className }: { readonly className?: string }) {
  return (
    <p className={className}>
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
        浙ICP备2026010374号-1
      </a>
      <span aria-hidden="true">&nbsp;·&nbsp;</span>
      主办单位：煊光（杭州）智能科技有限公司
    </p>
  );
}
