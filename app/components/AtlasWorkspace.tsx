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
      className={`grid h-screen overflow-hidden ${
        answerMode
          ? "grid-cols-[320px_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto]"
          : "grid-cols-[320px_minmax(0,1fr)_380px] grid-rows-[auto_auto_minmax(0,1fr)_auto]"
      }`}
    >
      <TopBar />
      <SearchBar />
      <SearchPanel />
      {answerMode ? (
        <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
          <ResultsPanel variant="answer" />
          <section className="min-h-0 border-l border-[var(--line)] bg-white">
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
