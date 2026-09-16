import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** 跟随流式内容；用户向上阅读后停止跟随，只滚动当前面板。 */
export function useFollowOutput(key: string, content: unknown, enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  const following = useRef(true);
  const [paused, setPaused] = useState(false);
  useLayoutEffect(() => { following.current = true; setPaused(false); }, [key]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (enabled && el && following.current) el.scrollTop = el.scrollHeight;
  }, [content, enabled, key]);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setPaused(!following.current);
  }, []);
  const resume = useCallback(() => {
    following.current = true; setPaused(false);
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, []);
  return { ref, onScroll, paused: enabled && paused, resume };
}
