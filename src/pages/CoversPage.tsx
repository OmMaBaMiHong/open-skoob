import { useSearchParams } from "react-router-dom";
import { CoverStudio } from "../components/CoverStudio";

export function CoversPage() {
  const [params] = useSearchParams();
  return <div className="page covers-page">
    <header className="page-top"><div><h1 className="page-title">天工封面</h1>
      <p className="cover-subtitle">根据故事题材，设计你的小说封面</p></div></header>
    <main className="page-body"><CoverStudio initialBookId={params.get("bookId") ?? undefined} /></main>
  </div>;
}
