import { fetchJson } from "./api";
import { apiUrl, CREDENTIALS } from "./api-origin";
import { authHeaders } from "./auth-storage";

export interface CoverTypography {
  template: "classic" | "modern" | "suspense" | "scifi";
  font: "serif" | "sans";
  color: string;
  position: "top" | "bottom";
}
export interface CoverStyle {
  id: string; name: string; genres: string[]; sampleUrl?: string;
  typography: CoverTypography;
}
export interface CoverCatalog {
  configured: boolean; styles: CoverStyle[]; defaultStyleId: string;
  recommendation?: { styleId: string; reason: string };
  models: { image?: { service: string; model: string }; text?: { service: string; model: string } };
}
export interface CoverInput {
  bookId?: string; title: string; genre: string; synopsis: string;
  prompt?: string; styleId?: string; typography?: CoverTypography;
}
export interface CoverJob {
  id: string;
  status: "queued" | "planning" | "generating" | "composing" | "completed" | "failed" | "uncertain";
  input: CoverInput; url?: string; rawUrl?: string; error?: string;
  styleName?: string; styleId?: string; configVersion?: number;
  typography?: CoverTypography;
  textModel?: string; imageModel?: string; createdAt: string;
}
export interface CoverMaterial {
  bookId: string; title: string; genre: string; synopsis: string; coverUrl: string | null;
}
export const COVER_STATUS: Record<CoverJob["status"], string> = {
  queued: "等待生成", planning: "策划中", generating: "生图中", composing: "排版中",
  completed: "已完成", failed: "生成失败", uncertain: "结果待核实",
};
export const isCoverRunning = (job: CoverJob) => ["queued", "planning", "generating", "composing"].includes(job.status);
export const fetchCoverCatalog = (genre?: string, signal?: AbortSignal) => fetchJson<CoverCatalog>(`/cover-studio/catalog${genre ? `?genre=${encodeURIComponent(genre)}` : ""}`, { cache: "no-store", signal });
export const fetchCoverMaterial = (id: string) => fetchJson<CoverMaterial>(`/cover-studio/material/${encodeURIComponent(id)}`, { cache: "no-store" });
export async function listCoverJobs(bookId?: string) {
  return (await fetchJson<{ jobs: CoverJob[] }>(`/cover-studio/jobs${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}`, { cache: "no-store" })).jobs;
}
export async function createCoverJob(input: CoverInput, key: string) {
  return (await fetchJson<{ job: CoverJob }>("/cover-studio/jobs", {
    method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input),
  })).job;
}
export async function recomposeCoverJob(id: string, title: string, typography: CoverTypography) {
  return (await fetchJson<{ job: CoverJob }>(`/cover-studio/jobs/${encodeURIComponent(id)}/recompose`, {
    method: "POST", body: JSON.stringify({ title, typography }),
  })).job;
}
export const applyCoverJob = (id: string, bookId: string) => fetchJson<{ url: string }>(`/cover-studio/jobs/${encodeURIComponent(id)}/apply`, {
  method: "POST", body: JSON.stringify({ bookId }),
});
export async function downloadCoverJob(job: CoverJob): Promise<void> {
  const response = await fetch(apiUrl(`/api/v1/cover-studio/jobs/${encodeURIComponent(job.id)}/image`), { headers: authHeaders(), credentials: CREDENTIALS });
  if (!response.ok) throw new Error(`下载失败（${response.status}），请刷新候选后重试`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${job.input.title}.png`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
