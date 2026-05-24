"use client";

import { Canvas3D } from "@/components/Canvas3D";
import { ResultsPanel } from "@/components/ResultsPanel";
import { SearchBar } from "@/components/SearchBar";
import { SearchPanel } from "@/components/SearchPanel";
import { TopBar } from "@/components/TopBar";
import { useAtlasStore } from "@/stores/atlas";

type AtlasWorkspaceProps = {
  footer: {
    datasetSnapshotLabel: string;
    datasetSnapshotValue: string;
    license: string;
    source: string;
    sourceLabel: string;
    sourceUrl: string;
  };
};

export function AtlasWorkspace({ footer }: AtlasWorkspaceProps) {
  const workspaceMode = useAtlasStore((state) => state.workspaceMode);
  const answerMode = workspaceMode === "answer";

  return (
    <div
      className={`grid min-h-screen grid-cols-1 overflow-x-hidden lg:h-screen lg:overflow-hidden ${
        answerMode
          ? "lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[auto_auto_minmax(0,1fr)_auto]"
          : "lg:grid-cols-[320px_minmax(0,1fr)_380px] lg:grid-rows-[auto_auto_minmax(0,1fr)_auto]"
      }`}
    >
      <TopBar />
      <SearchBar />
      <SearchPanel />
      {answerMode ? (
        <main className="grid min-h-[680px] grid-cols-1 overflow-visible lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
          <ResultsPanel variant="answer" />
          <section className="min-h-[420px] border-t border-[var(--line)] bg-white lg:min-h-0 lg:border-l lg:border-t-0">
            <Canvas3D compact />
          </section>
        </main>
      ) : (
        <>
          <Canvas3D />
          <ResultsPanel />
        </>
      )}
      <footer className="col-span-full border-t border-[var(--line)] px-4 py-3 text-xs text-neutral-600">
        {footer.sourceLabel}:{" "}
        <a className="text-[var(--accent)] underline" href={footer.sourceUrl} rel="noreferrer" target="_blank">
          {footer.source}
        </a>{" "}
        - {footer.license} - {footer.datasetSnapshotLabel}: {footer.datasetSnapshotValue}
      </footer>
    </div>
  );
}
