import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AUTH_CHANGED_EVENT, readAuth } from "../lib/auth-storage";
import { GeneralAgentDraft } from "../lib/general-agent-draft";

export function useGeneralDraft(sessionId: string | null) {
  const [identity, setIdentity] = useState(readAuth);
  useEffect(() => {
    const changed = () => setIdentity(readAuth());
    window.addEventListener(AUTH_CHANGED_EVENT, changed); window.addEventListener("storage", changed);
    return () => { window.removeEventListener(AUTH_CHANGED_EVENT, changed); window.removeEventListener("storage", changed); };
  }, []);
  const draft = useMemo(() => new GeneralAgentDraft(sessionId), [sessionId, identity?.userId, identity?.token]);
  useEffect(() => { draft.activate(); return () => draft.dispose(); }, [draft]);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  return { draft, state };
}
