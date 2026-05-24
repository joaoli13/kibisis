export type LicenseStatus = "cc_compatible" | "restricted" | "unknown";

export type Passage = {
  id: string;
  cts_urn: string;
  passage_ref: string;
  text: string;
  author_id?: string | null;
  author?: string | null;
  work_id?: string | null;
  work?: string | null;
  work_date?: string | null;
  genre?: string | null;
  period?: string | null;
  language?: string | null;
  text_type?: string | null;
  cluster_id?: string | null;
  source_url?: string | null;
  license_status: LicenseStatus;
};

export type SemanticNode = {
  id: string;
  cts_urn?: string | null;
  parent_id?: string | null;
  level: "passage" | "section" | "chapter" | "book" | "work" | "author";
  passage_id?: string | null;
  author_id?: string | null;
  work_id?: string | null;
  cluster_id?: string | null;
  passage_ref_range?: string | null;
  label?: string | null;
  work_label?: string | null;
  work_date?: string | null;
  author_label?: string | null;
  snippet?: string | null;
  genre?: string | null;
  period?: string | null;
  language?: string | null;
  token_count?: number;
  umap_3d?: [number, number, number] | number[] | null;
  license_status: LicenseStatus;
};

export type NodeLevel = Extract<SemanticNode["level"], "passage" | "work" | "author">;

export type SearchFilterValue = string | string[];

export type SearchFilters = {
  author?: SearchFilterValue;
  work?: SearchFilterValue;
  genre?: SearchFilterValue;
  period?: SearchFilterValue;
  language?: SearchFilterValue;
  textType?: SearchFilterValue;
};

export type FacetOption = {
  id: string;
  label: string;
  count?: number;
  work_count?: number;
  passage_count?: number;
  selected?: boolean;
  compatible?: boolean;
  author_id?: string | null;
};

export type MetadataFacets = {
  authors: FacetOption[];
  works: FacetOption[];
  genres: FacetOption[];
  periods: FacetOption[];
  languages: FacetOption[];
  textTypes: FacetOption[];
};

export type Provenance = {
  source: string;
  source_url: string;
  license: string;
  dataset_snapshot: string | null;
  notice: string;
};

export type SearchResult = Passage & {
  score: number;
  evidence: Array<"lex" | "vec_leaf" | "macro_expansion" | "static">;
};
