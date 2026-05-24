"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { firstFilterValue, onlyFilterValue, setFilterValue } from "@/lib/filters";
import { hasPassageNodeScope } from "@/lib/search-behavior";
import { useAtlasStore } from "@/stores/atlas";
import type { Passage, SemanticNode } from "@/lib/types";

const Plot = dynamic(
  async () => {
    const [{ default: createPlotlyComponent }, { default: Plotly }] = await Promise.all([
      import("react-plotly.js/factory"),
      import("plotly.js-dist-min")
    ]);
    return createPlotlyComponent(Plotly);
  },
  { ssr: false }
);

const POINT_PALETTE = [
  "#315f72",
  "#b45135",
  "#6f7f2a",
  "#8a4f7d",
  "#b67b1f",
  "#2f7d66",
  "#7257a6",
  "#a13f55",
  "#4f6fb3",
  "#7a5a2f",
  "#1f7a8c",
  "#9a6b22",
  "#486b3a",
  "#8f4f2d",
  "#5b5f7f",
  "#a64f79"
];

const MAP_TEXT_COLOR = "#2f332d";

function categoryColor(value: string): string {
  if (value === "none") {
    return "#6f6f68";
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return POINT_PALETTE[hash % POINT_PALETTE.length];
}

function escapeHover(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapHover(value: string, maxLineLength = 58, maxLines = 7): string {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLineLength && line) {
      lines.push(line);
      line = word;
      return;
    }
    line = next;
  });
  if (line) {
    lines.push(line);
  }
  return lines.slice(0, maxLines).map(escapeHover).join("<br>");
}

function fallbackLabel(node: SemanticNode): string {
  const ref = node.passage_ref_range ? ` ${node.passage_ref_range}` : "";
  if (node.level === "author") {
    return node.author_id ?? node.id;
  }
  if (node.level === "work") {
    return node.work_id ?? node.id;
  }
  return `${node.work_id ?? node.author_id ?? node.id}${ref}`;
}

function hoverText(node: SemanticNode): string {
  const label = node.label || fallbackLabel(node);
  const author = node.author_label || node.author_id;
  const ref = node.passage_ref_range ? `${node.level} ${node.passage_ref_range}` : node.level;
  const metadata = [author, ref, node.genre, node.period, node.language].filter(Boolean);
  const lines = [
    `<b>${wrapHover(label, 46)}</b>`,
    `<span style="color:var(--map-text)">${metadata.map(String).map(escapeHover).join(" · ")}</span>`
  ];
  if (node.snippet) {
    lines.push("", wrapHover(node.snippet, 68, 2));
  }
  return lines.join("<br>");
}

function passageIdForNode(node: SemanticNode | null): string | null {
  if (!node || node.level !== "passage") {
    return null;
  }
  if (node.passage_id) {
    return node.passage_id;
  }
  return node.id.startsWith("node:") ? node.id.slice("node:".length) : node.id;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }
  return String(value);
}

function passageToMapNode(passage: Passage): SemanticNode {
  return {
    id: `node:${passage.id}`,
    cts_urn: passage.cts_urn,
    level: "passage",
    passage_id: passage.id,
    author_id: passage.author_id,
    work_id: passage.work_id,
    cluster_id: passage.cluster_id,
    passage_ref_range: passage.passage_ref,
    label: passageTitleForNode(passage),
    work_label: passage.work,
    work_date: passage.work_date,
    author_label: passage.author,
    snippet: passage.text.replace(/\s+/g, " ").trim().split(" ").slice(0, 24).join(" "),
    genre: passage.genre,
    period: passage.period,
    language: passage.language,
    license_status: passage.license_status
  };
}

function passageTitleForNode(passage: Passage): string {
  return `${passage.work ?? passage.work_id ?? "Passage"} ${passage.passage_ref}`;
}

type Canvas3DProps = {
  compact?: boolean;
};

export function Canvas3D({ compact = false }: Canvas3DProps) {
  const t = useTranslations("canvas");
  const nodes = useAtlasStore((state) => state.nodes);
  const results = useAtlasStore((state) => state.results);
  const activeQuery = useAtlasStore((state) => state.activeQuery);
  const filters = useAtlasStore((state) => state.filters);
  const colorBy = useAtlasStore((state) => state.colorBy);
  const granularity = useAtlasStore((state) => state.granularity);
  const mapMode = useAtlasStore((state) => state.mapMode);
  const passageScopePrompt = useAtlasStore((state) => state.passageScopePrompt);
  const pointScale = useAtlasStore((state) => state.pointScale);
  const showLabels = useAtlasStore((state) => state.showLabels);
  const setFilters = useAtlasStore((state) => state.setFilters);
  const setColorBy = useAtlasStore((state) => state.setColorBy);
  const setGranularity = useAtlasStore((state) => state.setGranularity);
  const setMapMode = useAtlasStore((state) => state.setMapMode);
  const setPassageScopePrompt = useAtlasStore((state) => state.setPassageScopePrompt);
  const setPointScale = useAtlasStore((state) => state.setPointScale);
  const setShowLabels = useAtlasStore((state) => state.setShowLabels);
  const selectPassage = useAtlasStore((state) => state.selectPassage);
  const [activeMapNode, setActiveMapNode] = useState<SemanticNode | null>(null);
  const [activePassage, setActivePassage] = useState<Passage | null>(null);
  const [passageBusy, setPassageBusy] = useState(false);
  const [passageError, setPassageError] = useState(false);
  const [labelsBusy, setLabelsBusy] = useState(false);
  const visible = useMemo(
    () => nodes.filter((node) => node.level === granularity && Array.isArray(node.umap_3d)),
    [nodes, granularity]
  );
  const relatedIds = useMemo(() => {
    if (!results.length) {
      return null;
    }
    if (granularity === "author") {
      return new Set(results.map((result) => result.author_id).filter(Boolean) as string[]);
    }
    if (granularity === "work") {
      return new Set(results.map((result) => result.work_id).filter(Boolean) as string[]);
    }
    return new Set(results.map((result) => result.id));
  }, [granularity, results]);
  const isRelatedNode = useCallback(
    (node: SemanticNode) => {
      if (!relatedIds) {
        return true;
      }
      if (node.level === "author") {
        return Boolean(node.author_id && relatedIds.has(node.author_id));
      }
      if (node.level === "work") {
        return Boolean(node.work_id && relatedIds.has(node.work_id));
      }
      return Boolean((node.passage_id && relatedIds.has(node.passage_id)) || relatedIds.has(node.id));
    },
    [relatedIds]
  );
  const plotNodes = useMemo(
    () => (mapMode === "isolate" && relatedIds ? visible.filter(isRelatedNode) : visible),
    [isRelatedNode, mapMode, relatedIds, visible]
  );
  const nodeById = useMemo(() => new Map(plotNodes.map((node) => [node.id, node])), [plotNodes]);
  const passageNodeByPassageId = useMemo(() => {
    const entries = nodes
      .filter((node) => node.level === "passage")
      .flatMap((node) => {
        const passageId = passageIdForNode(node);
        return passageId ? ([[passageId, node]] as const) : [];
      });
    return new Map(entries);
  }, [nodes]);
  const activePassageId = passageIdForNode(activeMapNode);
  const selectedAuthor = onlyFilterValue(filters.author);
  const selectedWork = onlyFilterValue(filters.work);

  useEffect(() => {
    if (granularity === "author" && selectedAuthor) {
      setGranularity("work");
      setActiveMapNode(null);
      selectPassage(null);
    }
  }, [granularity, selectPassage, selectedAuthor, setGranularity]);

  useEffect(() => {
    function showMapPassage(event: Event) {
      const detail = (event as CustomEvent<{ passage?: Passage; passageId?: string }>).detail;
      const passage = detail?.passage;
      const passageId = detail?.passageId ?? passage?.id;
      if (!passageId) {
        return;
      }
      const node = passageNodeByPassageId.get(passageId) ?? (passage ? passageToMapNode(passage) : null);
      if (!node) {
        return;
      }
      setActiveMapNode(node);
      setActivePassage(passage ?? null);
      setPassageError(false);
      selectPassage(passageId);
    }

    window.addEventListener("kibisis:show-map-passage", showMapPassage);
    return () => window.removeEventListener("kibisis:show-map-passage", showMapPassage);
  }, [passageNodeByPassageId, selectPassage]);

  useEffect(() => {
    if (!activePassageId) {
      setActivePassage(null);
      setPassageBusy(false);
      setPassageError(false);
      return;
    }

    let cancelled = false;
    setPassageBusy(true);
    setPassageError(false);
    setActivePassage(null);
    fetch(`/api/passage/${encodeURIComponent(activePassageId)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("passage_not_found");
        }
        return response.json() as Promise<{ passage?: Passage }>;
      })
      .then((payload) => {
        if (!cancelled) {
          if (!payload.passage) {
            throw new Error("passage_not_found");
          }
          setActivePassage(payload.passage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActivePassage(null);
          setPassageError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPassageBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePassageId]);

  useEffect(() => {
    if (!labelsBusy) {
      return;
    }
    const handle = window.setTimeout(() => {
      setLabelsBusy(false);
    }, 2200);
    return () => window.clearTimeout(handle);
  }, [labelsBusy]);

  const metadataRows = useMemo(
    () => [
      [t("metadata.author"), activeMapNode?.author_label ?? activePassage?.author ?? activeMapNode?.author_id],
      [t("metadata.work"), activeMapNode?.work_label ?? activePassage?.work ?? activeMapNode?.work_id],
      [t("metadata.workDate"), activePassage?.work_date ?? activeMapNode?.work_date],
      [t("metadata.reference"), activePassage?.passage_ref ?? activeMapNode?.passage_ref_range],
      ["CTS URN", activePassage?.cts_urn ?? activeMapNode?.cts_urn],
      [t("metadata.language"), activePassage?.language ?? activeMapNode?.language],
      [t("metadata.genre"), activePassage?.genre ?? activeMapNode?.genre],
      [t("metadata.period"), activePassage?.period ?? activeMapNode?.period],
      [t("metadata.cluster"), activePassage?.cluster_id ?? activeMapNode?.cluster_id],
      [t("metadata.license"), activePassage?.license_status ?? activeMapNode?.license_status]
    ].filter(([, value]) => value !== null && value !== undefined && value !== ""),
    [activeMapNode, activePassage, t]
  );
  const plotData = useMemo(() => {
    const x = plotNodes.map((node) => Number(node.umap_3d?.[0] ?? 0));
    const y = plotNodes.map((node) => Number(node.umap_3d?.[1] ?? 0));
    const z = plotNodes.map((node) => Number(node.umap_3d?.[2] ?? 0));
    const markerSize = plotNodes.map((node) => {
      const base = node.level === "passage" ? 4 : Math.max(6, Math.log(Math.max(node.token_count ?? 1, 1)) * 2);
      const boost = relatedIds && isRelatedNode(node) ? 1.2 : 1;
      return base * pointScale * boost;
    });
    const color = plotNodes.map((node) => {
      if (mapMode === "highlight" && relatedIds && !isRelatedNode(node)) {
        return "#c9c5ba";
      }
      const key =
        colorBy === "cluster"
          ? node.cluster_id ?? "none"
          : colorBy === "author"
            ? node.author_id ?? "none"
            : colorBy === "genre"
              ? node.genre ?? "none"
              : node.period ?? "none";
      return categoryColor(key);
    });
    const hover = plotNodes.map(hoverText);
    const labels = plotNodes.map((node) => node.label || fallbackLabel(node));

    return [
      {
        type: "scatter3d",
        mode: showLabels ? "markers+text" : "markers",
        x,
        y,
        z,
        text: labels,
        hovertext: hover,
        textposition: "top center",
        textfont: { color: MAP_TEXT_COLOR, size: 10 },
        hovertemplate: "%{hovertext}<extra></extra>",
        customdata: plotNodes.map((node) => node.id),
        marker: {
          size: markerSize,
          color,
          opacity: 0.9,
          line: { color: "rgba(23, 23, 23, 0.32)", width: 1 }
        }
      }
    ];
  }, [colorBy, isRelatedNode, mapMode, plotNodes, pointScale, relatedIds, showLabels]);
  const layout = useMemo(
    () => ({
      autosize: true,
      margin: { l: 0, r: 0, t: 0, b: 0, pad: 0 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      hoverlabel: {
        align: "left",
        bgcolor: "#ffffff",
        bordercolor: "var(--hover-border)",
        font: { color: "#171717", size: 13 }
      },
      scene: {
        bgcolor: "#ffffff",
        aspectmode: "cube",
        camera: {
          eye: { x: 1.55, y: 1.65, z: 1.25 },
          center: { x: 0, y: 0, z: 0 }
        },
        xaxis: {
          title: { text: "X", font: { color: "#7a7d77", size: 12 } },
          visible: true,
          showbackground: false,
          showgrid: true,
          gridcolor: "var(--axis-grid)",
          gridwidth: 2,
          showline: true,
          linecolor: "var(--axis-line)",
          linewidth: 1,
          zeroline: true,
          zerolinecolor: "var(--axis-zero)",
          tickfont: { color: "var(--axis-text)", size: 10 },
          ticks: "",
          showspikes: false
        },
        yaxis: {
          title: { text: "Y", font: { color: "#7a7d77", size: 12 } },
          visible: true,
          showbackground: false,
          showgrid: true,
          gridcolor: "var(--axis-grid)",
          gridwidth: 2,
          showline: true,
          linecolor: "var(--axis-line)",
          linewidth: 1,
          zeroline: true,
          zerolinecolor: "var(--axis-zero)",
          tickfont: { color: "var(--axis-text)", size: 10 },
          ticks: "",
          showspikes: false
        },
        zaxis: {
          title: { text: "Z", font: { color: "#7a7d77", size: 12 } },
          visible: true,
          showbackground: false,
          showgrid: true,
          gridcolor: "var(--axis-grid)",
          gridwidth: 2,
          showline: true,
          linecolor: "var(--axis-line)",
          linewidth: 1,
          zeroline: true,
          zerolinecolor: "var(--axis-zero)",
          tickfont: { color: "var(--axis-text)", size: 10 },
          ticks: "",
          showspikes: false
        }
      }
    }),
    []
  );
  const handleClick = useCallback(
    (event: { points: Array<{ customdata?: unknown }> }) => {
      const point = event.points[0];
      const id = point?.customdata;
      const node = typeof id === "string" ? nodeById.get(id) : undefined;
      if (!node) {
        return;
      }
      if (node.level === "author" && node.author_id) {
        setActiveMapNode(null);
        setFilters(setFilterValue(filters, "author", node.author_id));
        setGranularity("work");
        selectPassage(null);
        return;
      }
      if (node.level === "work" && node.work_id) {
        setActiveMapNode(null);
        setFilters(setFilterValue({ ...filters, author: node.author_id ?? firstFilterValue(filters.author) }, "work", node.work_id));
        setGranularity("passage");
        selectPassage(null);
        return;
      }
      if (node.level === "passage") {
        setActiveMapNode(node);
        selectPassage(passageIdForNode(node));
      }
    },
    [filters, nodeById, selectPassage, setFilters, setGranularity]
  );
  const chooseLevel = useCallback(
    (level: typeof granularity) => {
      if (level === "passage" && !hasPassageNodeScope(activeQuery, filters)) {
        setPassageScopePrompt(true);
        return;
      }
      setPassageScopePrompt(false);
      if (level === "author") {
        setFilters({ ...filters, author: undefined, work: undefined });
      } else if (level === "work") {
        setFilters({ ...filters, work: undefined });
      }
      setGranularity(level);
      setActiveMapNode(null);
      selectPassage(null);
    },
    [activeQuery, filters, selectPassage, setFilters, setGranularity, setPassageScopePrompt]
  );
  const authorLabel = useMemo(
    () => visible.find((node) => node.author_id === selectedAuthor)?.author_label ?? selectedAuthor,
    [selectedAuthor, visible]
  );
  const workLabel = useMemo(
    () => visible.find((node) => node.work_id === selectedWork)?.work_label ?? selectedWork,
    [selectedWork, visible]
  );
  const openPassageText = useCallback(() => {
    if (!activePassageId) {
      return;
    }
    selectPassage(activePassageId);
    window.dispatchEvent(new CustomEvent("kibisis:open-passage-detail", { detail: { passageId: activePassageId } }));
  }, [activePassageId, selectPassage]);
  const toggleLabels = useCallback(() => {
    const nextShowLabels = !showLabels;
    setShowLabels(nextShowLabels);
    setLabelsBusy(nextShowLabels);
  }, [setShowLabels, showLabels]);
  const finishLabelRender = useCallback(() => {
    setLabelsBusy(false);
  }, []);

  return (
    <main className={`flex min-h-[460px] flex-col lg:min-h-0 ${compact ? "lg:h-full" : ""}`}>
      <div className="flex flex-col items-stretch gap-2 border-b border-[var(--line)] bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(["author", "work", "passage"] as const).map((level) => (
            <button
              aria-pressed={granularity === level}
              className={`border px-2 py-1 text-sm font-medium transition ${
                granularity === level
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-inner"
                  : "border-[var(--line)] bg-white text-neutral-700 hover:border-[var(--accent)]"
              }`}
              key={level}
              onClick={() => chooseLevel(level)}
              type="button"
            >
              {t(`levels.${level}`)}
            </button>
          ))}
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-neutral-600 sm:ml-2">
            <button className="hover:text-[var(--accent)]" onClick={() => chooseLevel("author")} type="button">
              {t("allAuthors")}
            </button>
            {selectedAuthor ? (
              <>
                <span>/</span>
                <button className="max-w-40 truncate hover:text-[var(--accent)]" onClick={() => chooseLevel("work")} type="button">
                  {authorLabel}
                </button>
              </>
            ) : null}
            {selectedWork ? (
              <>
                <span>/</span>
                <span className="max-w-40 truncate">{workLabel}</span>
              </>
            ) : null}
          </div>
        </div>
        <select
          className="w-full border border-[var(--line)] px-2 py-1 text-sm sm:w-auto"
          value={colorBy}
          onChange={(event) => setColorBy(event.target.value as typeof colorBy)}
        >
          <option value="cluster">{t("colorBy.cluster")}</option>
          <option value="author">{t("colorBy.author")}</option>
          <option value="genre">{t("colorBy.genre")}</option>
          <option value="period">{t("colorBy.period")}</option>
        </select>
      </div>
      <div className="relative min-h-[360px] flex-1 lg:min-h-0">
        <Plot
          data={plotData}
          layout={layout}
          config={{
            displaylogo: false,
            responsive: true,
            modeBarButtonsToRemove: ["toImage", "sendDataToCloud"]
          }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
          onClick={handleClick}
          onAfterPlot={finishLabelRender}
        />
        {labelsBusy ? (
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-700 shadow-lg">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            {t("loading")}
          </div>
        ) : null}
        {passageScopePrompt ? (
          <aside className={`absolute left-4 z-10 w-[min(420px,calc(100%-2rem))] border border-[var(--line)] bg-white p-4 shadow-xl ${labelsBusy ? "top-16" : "top-4"}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{t("scopePrompt.label")}</div>
            <h2 className="mt-1 text-base font-semibold">{t("scopePrompt.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-700">{t("scopePrompt.body")}</p>
            <div className="mt-3 grid gap-2 text-xs text-neutral-600">
              <div>{t("scopePrompt.chooseAuthor")}</div>
              <div>{t("scopePrompt.chooseWork")}</div>
              <div>{t("scopePrompt.search")}</div>
            </div>
          </aside>
        ) : null}
        {activeMapNode ? (
          <aside className="absolute left-4 right-4 top-4 z-10 border border-[var(--line)] bg-white p-4 shadow-xl sm:left-auto sm:w-[min(380px,calc(100%-2rem))]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{t("passageMetadata")}</div>
                <h2 className="mt-1 truncate text-base font-semibold">
                  {activeMapNode.label ?? activeMapNode.work_label ?? activeMapNode.work_id ?? t("passage")}
                </h2>
              </div>
              <button
                aria-label={t("closeMetadata")}
                className="border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                onClick={() => setActiveMapNode(null)}
                type="button"
              >
                {t("close")}
              </button>
            </div>
            <dl className="grid gap-x-3 gap-y-2 text-xs sm:grid-cols-[104px_minmax(0,1fr)]">
              {metadataRows.map(([label, value]) => (
                <div className="contents" key={label}>
                  <dt className="font-semibold uppercase tracking-wide text-neutral-500">{label}</dt>
                  <dd className="min-w-0 break-words text-neutral-800">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
            {activeMapNode.snippet ? (
              <p className="mt-3 border-t border-[var(--line)] pt-3 text-sm leading-5 text-neutral-700">{activeMapNode.snippet}</p>
            ) : null}
            {passageError ? (
              <p className="mt-3 text-xs text-red-700">{t("loadPassageError")}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={!activePassageId || passageBusy}
                onClick={openPassageText}
                type="button"
              >
                {passageBusy ? t("loading") : t("goToText")}
              </button>
              {activePassage?.source_url ? (
                <a className="border border-[var(--line)] px-3 py-2 text-sm text-[var(--accent)]" href={activePassage.source_url}>
                  {t("source")}
                </a>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
      <div
        className={`grid gap-4 border-t border-dotted border-[var(--line)] bg-white px-4 py-3 ${
          compact ? "grid-cols-1" : "md:grid-cols-[minmax(260px,1fr)_minmax(220px,1fr)_minmax(180px,0.75fr)]"
        }`}
      >
        <section>
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-700">
            {t("mode")}
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] text-[11px] text-neutral-500">
              ?
            </span>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded border border-[var(--line)]">
            <button
              className={`px-4 py-2 text-sm font-semibold transition ${
                mapMode === "highlight"
                  ? "bg-[var(--accent)] text-white shadow-inner"
                  : "bg-[var(--surface-muted)] text-neutral-700 hover:bg-white"
              }`}
              onClick={() => setMapMode("highlight")}
              type="button"
            >
              {t("highlight")}
            </button>
            <button
              className={`border-l border-[var(--line)] px-4 py-2 text-sm font-semibold transition ${
                mapMode === "isolate"
                  ? "bg-[var(--accent)] text-white shadow-inner"
                  : "bg-[var(--surface-muted)] text-neutral-700 hover:bg-white"
              }`}
              onClick={() => setMapMode("isolate")}
              type="button"
            >
              {t("isolate")}
            </button>
          </div>
        </section>
        <section>
          <label className="mb-4 block text-xs font-semibold uppercase tracking-wide text-neutral-700" htmlFor="point-size">
            {t("pointSize")}
          </label>
          <input
            className="w-full accent-[var(--accent)]"
            id="point-size"
            max="2"
            min="0.6"
            onChange={(event) => setPointScale(Number(event.target.value))}
            step="0.05"
            type="range"
            value={pointScale}
          />
        </section>
        <section>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("layers")}</div>
          <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-800">
            {t("showLabels")}
            <span className="flex items-center gap-2">
              {labelsBusy ? (
                <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                  {t("loading")}
                </span>
              ) : null}
              <button
                aria-busy={labelsBusy}
                aria-pressed={showLabels}
                className={`relative h-7 w-12 rounded-full transition ${showLabels ? "bg-[var(--accent)]" : "bg-neutral-300"}`}
                onClick={toggleLabels}
                type="button"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${showLabels ? "left-6" : "left-1"}`}
                />
              </button>
            </span>
          </label>
        </section>
      </div>
    </main>
  );
}
