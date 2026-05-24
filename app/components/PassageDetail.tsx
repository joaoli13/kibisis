"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useAtlasStore } from "@/stores/atlas";

export function PassageDetail() {
  const t = useTranslations("resultsPanel");
  const { results, selectedPassageId, selectPassage } = useAtlasStore();
  const selected = useMemo(
    () => results.find((passage) => passage.id === selectedPassageId) ?? results[0],
    [results, selectedPassageId]
  );

  return (
    <aside className="h-full overflow-auto border-l border-[var(--line)] bg-white p-4">
      <div className="mb-4 space-y-2">
        {results.slice(0, 10).map((result, index) => (
          <button
            className="block w-full border-b border-[var(--line)] py-2 text-left text-sm hover:text-[var(--accent)]"
            key={result.id}
            onClick={() => selectPassage(result.id)}
            type="button"
          >
            [{index + 1}] {result.work ?? result.work_id ?? t("workFallback")} {result.passage_ref}
          </button>
        ))}
      </div>
      {selected ? (
        <article className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-neutral-600">{selected.cts_urn}</div>
          <h2 className="text-lg font-semibold">{selected.work ?? selected.work_id ?? t("passageFallback")}</h2>
          <p className="whitespace-pre-wrap leading-7">{selected.text}</p>
          {selected.source_url ? (
            <a className="text-sm text-[var(--accent)] underline" href={selected.source_url}>
              {t("source")}
            </a>
          ) : null}
        </article>
      ) : (
        <div className="text-sm text-neutral-600">{t("noPassageSelected")}</div>
      )}
    </aside>
  );
}
