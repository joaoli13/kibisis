"use client";

import { create } from "zustand";
import type { NodeLevel, Passage, SearchFilters, SearchResult, SemanticNode } from "@/lib/types";

export type AnswerSource = {
  n: number;
  passage: Passage;
};

type AtlasState = {
  query: string;
  activeQuery: string;
  filters: SearchFilters;
  answerError: string;
  answerMarkdown: string;
  answerQuestion: string;
  answerSources: AnswerSource[];
  results: SearchResult[];
  nodes: SemanticNode[];
  selectedPassageId: string | null;
  colorBy: "cluster" | "author" | "genre" | "period";
  granularity: NodeLevel;
  mapMode: "highlight" | "isolate";
  pointScale: number;
  passageScopePrompt: boolean;
  showLabels: boolean;
  workspaceMode: "explore" | "answer";
  setQuery: (query: string) => void;
  setActiveQuery: (query: string) => void;
  setAnswerError: (answerError: string) => void;
  setAnswerMarkdown: (answerMarkdown: string) => void;
  setAnswerQuestion: (answerQuestion: string) => void;
  setAnswerSources: (answerSources: AnswerSource[]) => void;
  setFilters: (filters: SearchFilters) => void;
  setResults: (results: SearchResult[]) => void;
  setNodes: (nodes: SemanticNode[]) => void;
  selectPassage: (id: string | null) => void;
  setColorBy: (colorBy: AtlasState["colorBy"]) => void;
  setGranularity: (granularity: NodeLevel) => void;
  setMapMode: (mapMode: AtlasState["mapMode"]) => void;
  setPointScale: (pointScale: number) => void;
  setPassageScopePrompt: (passageScopePrompt: boolean) => void;
  setShowLabels: (showLabels: boolean) => void;
  setWorkspaceMode: (workspaceMode: AtlasState["workspaceMode"]) => void;
};

export const useAtlasStore = create<AtlasState>((set) => ({
  query: "",
  activeQuery: "",
  filters: {},
  answerError: "",
  answerMarkdown: "",
  answerQuestion: "",
  answerSources: [],
  results: [],
  nodes: [],
  selectedPassageId: null,
  colorBy: "cluster",
  granularity: "author",
  mapMode: "highlight",
  pointScale: 1,
  passageScopePrompt: false,
  showLabels: false,
  workspaceMode: "explore",
  setQuery: (query) => set({ query }),
  setActiveQuery: (activeQuery) => set({ activeQuery }),
  setAnswerError: (answerError) => set({ answerError }),
  setAnswerMarkdown: (answerMarkdown) => set({ answerMarkdown }),
  setAnswerQuestion: (answerQuestion) => set({ answerQuestion }),
  setAnswerSources: (answerSources) => set({ answerSources }),
  setFilters: (filters) => set({ filters }),
  setResults: (results) => set({ results }),
  setNodes: (nodes) => set({ nodes }),
  selectPassage: (id) => set({ selectedPassageId: id }),
  setColorBy: (colorBy) => set({ colorBy }),
  setGranularity: (granularity) => set({ granularity }),
  setMapMode: (mapMode) => set({ mapMode }),
  setPointScale: (pointScale) => set({ pointScale }),
  setPassageScopePrompt: (passageScopePrompt) => set({ passageScopePrompt }),
  setShowLabels: (showLabels) => set({ showLabels }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode })
}));
