import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBrainstormCardPage, reportBrainstormEvents, type BrainstormCard } from "../lib/api";

/** 横向灵感轨道：浏览历史时冻结首屏，避免自动刷新改变阅读位置。 */
export function useBrainstormCards(canRefresh: () => boolean) {
  const [cards, setCards] = useState<ReadonlyArray<BrainstormCard>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const refreshAllowed = useRef(canRefresh);
  refreshAllowed.current = canRefresh;
  const seen = useRef(new Set<string>());
  const load = useCallback(async (append: boolean, refresh = false) => {
    if (busy.current || (append && !cursor.current)) return;
    busy.current = true;
    setLoading(true); setError(null);
    try {
      const page = await fetchBrainstormCardPage(12, { refresh, ...(append ? { after: cursor.current! } : {}) });
      if (!mounted.current) return;
      setCards(previous => append ? [...previous, ...page.cards.filter(card => !previous.some(old => old.id === card.id))] : page.cards);
      cursor.current = page.nextCursor;
      setNextCursor(page.nextCursor);
      const fresh = page.cards.filter(card => !seen.current.has(card.id));
      fresh.forEach(card => seen.current.add(card.id));
      if (fresh.length) void reportBrainstormEvents(fresh.map(card => ({ cardId: card.id, type: "impression" as const })));
    } catch {
      if (mounted.current) setError("灵感加载失败，点击重试");
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { if (!document.hidden && refreshAllowed.current()) void load(false); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { mounted.current = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  return { cards, loading, error, hasMore: nextCursor !== null, loadMore: () => load(true), retry: () => load(cursor.current !== null, true) };
}
