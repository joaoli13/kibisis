import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { filterHasValue, normalizeSearchFilters, valuesForFilter } from "./filters";
import type { FacetOption, MetadataFacets, MetadataSummary, NodeLevel, Passage, SearchFilters, SearchResult, SemanticNode } from "./types";

let pool: Pool | undefined;

const PASSAGE_SELECT = `
  p.id,
  p.cts_urn,
  p.passage_ref,
  p.text,
  p.author_id,
  p.work_id,
  p.genre,
  p.period,
  p.language,
  p.text_type,
  p.cluster_id,
  p.source_url,
  p.license_status,
  w.date_hint AS work_date
`;

const NODE_SELECT = `
  n.id,
  n.parent_id,
  n.level,
  n.passage_id,
  n.author_id,
  n.work_id,
  n.cluster_id,
  n.genre,
  n.period,
  n.language,
  n.token_count,
  n.umap_3d,
  n.license_status,
  n.passage_ref_range,
  w.title AS work_label,
  w.date_hint AS work_date,
  a.name AS author_label,
  CASE
    WHEN n.level = 'passage' THEN concat_ws(' ', COALESCE(w.title, n.work_id), p.passage_ref)
    WHEN n.level = 'author' THEN COALESCE(a.name, n.author_id)
    WHEN n.level = 'work' THEN COALESCE(w.title, n.work_id)
    ELSE concat_ws(' ', COALESCE(w.title, n.work_id), n.passage_ref_range)
  END AS label,
  CASE
    WHEN n.level = 'passage' THEN array_to_string(
      (regexp_split_to_array(regexp_replace(p.text, '\\s+', ' ', 'g'), ' '))[1:20],
      ' '
    )
    ELSE NULL
  END AS snippet
`;

type RankedPassageCandidate = {
  score: number;
  evidence: SearchResult["evidence"];
};

export function dataSource(): "postgres" {
  return "postgres";
}

export function isDatabaseConfigurationError(error: unknown): boolean {
  return error instanceof Error && error.message === "DATABASE_URL is not configured";
}

function ensureDatabaseUrl(): string {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && process.env.PERSEUS_LOAD_ROOT_ENV !== "false") {
    loadEnvConfig(resolve(process.cwd(), ".."));
  }
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return databaseUrl;
}

function getPool(): Pool {
  pool ??= new Pool({ connectionString: ensureDatabaseUrl() });
  return pool;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toFixed(9)).join(",")}]`;
}

async function embedQuery(query: string): Promise<number[] | null> {
  if (!query.trim() || !process.env.GEMINI_API_KEY) {
    return null;
  }
  try {
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = client.getGenerativeModel({ model: "gemini-embedding-001" });
    const response = await model.embedContent({
      content: { role: "user", parts: [{ text: query }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768
    } as never);
    const embedding = response.embedding.values.map((value) => Number(value));
    if (embedding.length !== 768) {
      throw new Error(`Expected 768D query embedding, received ${embedding.length}D`);
    }
    return embedding;
  } catch (error) {
    console.error(JSON.stringify({
      route: "/api/search",
      provider: "gemini",
      operation: "query_embedding",
      error: error instanceof Error ? error.message : "unknown query embedding error"
    }));
    return null;
  }
}

function rrf(rank: number, weight = 1, k = 60): number {
  return weight / (k + rank);
}

function mergeCandidate(
  target: Map<string, RankedPassageCandidate>,
  id: string,
  score: number,
  evidence: SearchResult["evidence"][number]
) {
  const existing = target.get(id);
  if (existing) {
    existing.score += score;
    if (!existing.evidence.includes(evidence)) {
      existing.evidence.push(evidence);
    }
    return;
  }
  target.set(id, { score, evidence: [evidence] });
}

function addTextSqlFilter(where: string[], values: unknown[], expression: string, value: SearchFilters[keyof SearchFilters]) {
  const filterValues = valuesForFilter(value);
  if (!filterValues.length) {
    return;
  }
  values.push(filterValues);
  where.push(`EXISTS (SELECT 1 FROM unnest($${values.length}::text[]) AS f(value) WHERE ${expression} ILIKE '%' || f.value || '%')`);
}

function addPassageSqlFilters(
  where: string[],
  values: unknown[],
  filters: SearchFilters,
  passageAlias = "p",
  authorAlias = "a",
  workAlias = "w"
) {
  const authorValues = valuesForFilter(filters.author);
  if (authorValues.length) {
    values.push(authorValues);
    const index = values.length;
    where.push(
      `EXISTS (SELECT 1 FROM unnest($${index}::text[]) AS f(value) WHERE ${passageAlias}.author_id = f.value OR ${authorAlias}.name ILIKE '%' || f.value || '%' OR f.value = ANY(${authorAlias}.name_variants))`
    );
  }
  const workValues = valuesForFilter(filters.work);
  if (workValues.length) {
    values.push(workValues);
    const index = values.length;
    where.push(`EXISTS (SELECT 1 FROM unnest($${index}::text[]) AS f(value) WHERE ${passageAlias}.work_id = f.value OR ${workAlias}.title ILIKE '%' || f.value || '%')`);
  }
  addTextSqlFilter(where, values, `${passageAlias}.genre`, filters.genre);
  addTextSqlFilter(where, values, `${passageAlias}.period`, filters.period);
  addTextSqlFilter(where, values, `${passageAlias}.language`, filters.language);
  addTextSqlFilter(where, values, `${passageAlias}.text_type`, filters.textType);
}

function hasPassageMetadataFilters(filters: SearchFilters): boolean {
  return Boolean(
    valuesForFilter(filters.genre).length ||
      valuesForFilter(filters.period).length ||
      valuesForFilter(filters.language).length ||
      valuesForFilter(filters.textType).length
  );
}

function addNodePassageMetadataScope(
  where: string[],
  values: unknown[],
  filters: SearchFilters,
  nodeAlias = "n"
) {
  if (!hasPassageMetadataFilters(filters)) {
    return;
  }

  const scopedWhere = ["scoped_p.license_status = 'cc_compatible'"];
  addTextSqlFilter(scopedWhere, values, "scoped_p.genre", filters.genre);
  addTextSqlFilter(scopedWhere, values, "scoped_p.period", filters.period);
  addTextSqlFilter(scopedWhere, values, "scoped_p.language", filters.language);
  addTextSqlFilter(scopedWhere, values, "scoped_p.text_type", filters.textType);

  where.push(`
    EXISTS (
      SELECT 1
      FROM published_passages scoped_p
      WHERE ${scopedWhere.join(" AND ")}
        AND (
          (${nodeAlias}.level = 'author' AND scoped_p.author_id = ${nodeAlias}.author_id)
          OR (${nodeAlias}.level = 'work' AND scoped_p.work_id = ${nodeAlias}.work_id)
          OR (${nodeAlias}.level = 'passage' AND scoped_p.id = ${nodeAlias}.passage_id)
          OR (
            ${nodeAlias}.level NOT IN ('author', 'work', 'passage')
            AND (
              (${nodeAlias}.passage_id IS NOT NULL AND scoped_p.id = ${nodeAlias}.passage_id)
              OR (${nodeAlias}.work_id IS NOT NULL AND scoped_p.work_id = ${nodeAlias}.work_id)
              OR (${nodeAlias}.author_id IS NOT NULL AND scoped_p.author_id = ${nodeAlias}.author_id)
            )
          )
        )
    )
  `);
}

function addNodeSqlFilters(
  where: string[],
  values: unknown[],
  filters: SearchFilters,
  nodeAlias = "n",
  authorAlias = "a",
  workAlias = "w"
) {
  const authorValues = valuesForFilter(filters.author);
  if (authorValues.length) {
    values.push(authorValues);
    const index = values.length;
    where.push(
      `EXISTS (SELECT 1 FROM unnest($${index}::text[]) AS f(value) WHERE ${nodeAlias}.author_id = f.value OR ${authorAlias}.name ILIKE '%' || f.value || '%' OR f.value = ANY(${authorAlias}.name_variants))`
    );
  }
  const workValues = valuesForFilter(filters.work);
  if (workValues.length) {
    values.push(workValues);
    const index = values.length;
    where.push(
      `EXISTS (SELECT 1 FROM unnest($${index}::text[]) AS f(value) WHERE ${nodeAlias}.work_id = f.value OR ${workAlias}.title ILIKE '%' || f.value || '%' OR (${nodeAlias}.level = 'author' AND EXISTS (SELECT 1 FROM works matched_work WHERE matched_work.author_id = ${nodeAlias}.author_id AND (matched_work.id = f.value OR matched_work.title ILIKE '%' || f.value || '%'))))`
    );
  }
  addNodePassageMetadataScope(where, values, filters, nodeAlias);
}

export function shouldPreferEnglishTranslations(filters: SearchFilters): boolean {
  return !valuesForFilter(filters.language).length && !valuesForFilter(filters.textType).length;
}

export function englishTranslationSearchFilters(filters: SearchFilters): SearchFilters {
  return { ...filters, language: "en", textType: "translation" };
}

async function rankPassages(
  client: PoolClient,
  query: string,
  filters: SearchFilters,
  limit: number,
  embedding: number[] | null,
  excludeIds = new Set<string>()
): Promise<SearchResult[]> {
  const fused = new Map<string, RankedPassageCandidate>();
  const lexicalValues: unknown[] = [query, Math.max(limit * 3, limit)];
  const lexicalWhere: string[] = ["p.license_status = 'cc_compatible'"];
  addPassageSqlFilters(lexicalWhere, lexicalValues, filters);
  const lexical = await client.query<{ id: string; rank: number }>(
    `
    SELECT p.id, ts_rank(p.tsv, plainto_tsquery('simple', $1)) AS rank
    FROM published_passages p
    JOIN authors a ON a.id = p.author_id
    JOIN works w ON w.id = p.work_id
    WHERE ${lexicalWhere.join(" AND ")}
      AND ($1 = '' OR p.tsv @@ plainto_tsquery('simple', $1))
    ORDER BY rank DESC
    LIMIT $2
    `,
    lexicalValues
  );
  lexical.rows.forEach((row, index) => mergeCandidate(fused, row.id, rrf(index + 1), "lex"));

  if (embedding) {
    const vector = vectorLiteral(embedding);
    const vectorValues: unknown[] = [vector, Math.max(limit * 3, limit)];
    const vectorWhere: string[] = ["p.license_status = 'cc_compatible'"];
    addPassageSqlFilters(vectorWhere, vectorValues, filters);
    const leafVector = await client.query<{ id: string; distance: number }>(
      `
      SELECT p.id, n.embedding <=> $1::vector AS distance
      FROM published_nodes n
      JOIN published_passages p ON p.id = n.passage_id
      JOIN authors a ON a.id = p.author_id
      JOIN works w ON w.id = p.work_id
      WHERE n.level = 'passage'
        AND n.embedding IS NOT NULL
        AND ${vectorWhere.join(" AND ")}
      ORDER BY n.embedding <=> $1::vector
      LIMIT $2
      `,
      vectorValues
    );
    leafVector.rows.forEach((row, index) => mergeCandidate(fused, row.id, rrf(index + 1), "vec_leaf"));

    const macroValues: unknown[] = [vector, 5];
    const macroWhere: string[] = ["n.license_status = 'cc_compatible'"];
    addNodeSqlFilters(macroWhere, macroValues, filters);
    const macro = await client.query<{ id: string; distance: number }>(
      `
      SELECT n.id, n.embedding <=> $1::vector AS distance
      FROM published_nodes n
      LEFT JOIN authors a ON a.id = n.author_id
      LEFT JOIN works w ON w.id = n.work_id
      WHERE n.level IN ('section', 'chapter', 'book', 'work', 'author')
        AND n.embedding IS NOT NULL
        AND ${macroWhere.join(" AND ")}
      ORDER BY n.embedding <=> $1::vector
      LIMIT $2
      `,
      macroValues
    );
    for (const [macroIndex, row] of macro.rows.entries()) {
      const expansionValues: unknown[] = [row.id, vector, Math.max(limit, 10)];
      const expansionWhere: string[] = ["p.license_status = 'cc_compatible'"];
      addPassageSqlFilters(expansionWhere, expansionValues, filters);
      const expanded = await client.query<{ id: string; distance: number }>(
        `
        WITH RECURSIVE tree AS (
          SELECT id, parent_id, level, passage_id
          FROM published_nodes
          WHERE id = $1
          UNION ALL
          SELECT child.id, child.parent_id, child.level, child.passage_id
          FROM published_nodes child
          JOIN tree parent ON child.parent_id = parent.id
        )
        SELECT p.id, leaf.embedding <=> $2::vector AS distance
        FROM tree
        JOIN published_nodes leaf ON leaf.id = tree.id
        JOIN published_passages p ON p.id = tree.passage_id
        JOIN authors a ON a.id = p.author_id
        JOIN works w ON w.id = p.work_id
        WHERE tree.level = 'passage'
          AND leaf.embedding IS NOT NULL
          AND ${expansionWhere.join(" AND ")}
        ORDER BY leaf.embedding <=> $2::vector
        LIMIT $3
        `,
        expansionValues
      );
      expanded.rows.forEach((passage, passageIndex) => {
        mergeCandidate(fused, passage.id, rrf(macroIndex + passageIndex + 1, 0.5), "macro_expansion");
      });
    }
  }

  const ranked = [...fused.entries()]
    .filter(([id]) => !excludeIds.has(id))
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, limit);
  if (!ranked.length) {
    return [];
  }

  const ids = ranked.map(([id]) => id);
  const passages = await client.query<Passage>(
    `
    SELECT ${PASSAGE_SELECT}, a.name AS author, w.title AS work
    FROM published_passages p
    JOIN authors a ON a.id = p.author_id
    JOIN works w ON w.id = p.work_id
    WHERE p.id = ANY($1::text[])
      AND p.license_status = 'cc_compatible'
    `,
    [ids]
  );
  const byId = new Map(passages.rows.map((passage) => [passage.id, passage]));
  return ranked.flatMap(([id, candidate]) => {
    const passage = byId.get(id);
    return passage ? [{ ...passage, score: candidate.score, evidence: candidate.evidence }] : [];
  });
}

export async function searchPassages(query: string, filters: SearchFilters, limit = 20): Promise<SearchResult[]> {
  const client = await getPool().connect();
  try {
    const embedding = await embedQuery(query);
    if (!shouldPreferEnglishTranslations(filters)) {
      return rankPassages(client, query, filters, limit, embedding);
    }

    const preferred = await rankPassages(client, query, englishTranslationSearchFilters(filters), limit, embedding);
    if (preferred.length >= limit) {
      return preferred;
    }

    const excludeIds = new Set(preferred.map((passage) => passage.id));
    const fallback = await rankPassages(client, query, filters, limit - preferred.length, embedding, excludeIds);
    return [...preferred, ...fallback];
  } finally {
    client.release();
  }
}

export async function getPassage(id: string): Promise<Passage | null> {
  const result = await getPool().query<Passage>(
    `
    SELECT ${PASSAGE_SELECT}, a.name AS author, w.title AS work
    FROM published_passages p
    JOIN authors a ON a.id = p.author_id
    JOIN works w ON w.id = p.work_id
    WHERE p.id = $1 AND p.license_status = 'cc_compatible'
    LIMIT 1
    `,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getPassages(ids: string[]): Promise<Passage[]> {
  const passages = await Promise.all(ids.map((id) => getPassage(id)));
  return passages.filter((passage): passage is Passage => passage !== null);
}

function filtersWithout(filters: SearchFilters, key: keyof SearchFilters): SearchFilters {
  return { ...filters, [key]: undefined };
}

type MetadataFacetOptions = {
  dashboard?: boolean;
  scope?: "compatible" | "corpus";
  facet?: keyof MetadataFacets;
  facetQuery?: string;
  limit?: number;
};

function markFacetOptions(
  rows: FacetOption[],
  compatibleIds: Set<string>,
  filters: SearchFilters,
  key: keyof SearchFilters
): FacetOption[] {
  return rows.map((option) => ({
    ...option,
    selected: filterHasValue(filters, key, option.id),
    compatible: compatibleIds.has(option.id)
  }));
}

export async function getMetadataFacets(filters: SearchFilters = {}, options: MetadataFacetOptions = {}): Promise<MetadataFacets> {
  const normalizedFilters = normalizeSearchFilters(filters);
  const dashboard = Boolean(options.dashboard);
  const scope = options.scope ?? "compatible";
  const topLimit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
  const facetQuery = options.facetQuery?.trim();
  const scoped = (key: keyof SearchFilters) => {
    const values: unknown[] = [];
    const where = ["p.license_status = 'cc_compatible'"];
    addPassageSqlFilters(where, values, filtersWithout(normalizedFilters, key));
    return { where: where.join(" AND "), values };
  };
  const corpus = () => ({ where: "p.license_status = 'cc_compatible'", values: [] as unknown[] });
  const authorScope = scoped("author");
  const workScope = scoped("work");
  const genreScope = scoped("genre");
  const periodScope = scoped("period");
  const languageScope = scoped("language");
  const textTypeScope = scoped("textType");
  function addFacetQuery(scope: { where: string; values: unknown[] }, expression: "a.name" | "w.title") {
    if (!facetQuery) {
      return scope;
    }
    return {
      where: `${scope.where} AND ${expression} ILIKE '%' || $${scope.values.length + 1} || '%'`,
      values: [...scope.values, facetQuery]
    };
  }

  const authorResultScope = dashboard && scope === "corpus" ? corpus() : authorScope;
  const workResultScope = dashboard && scope === "corpus" ? corpus() : workScope;
  const genreResultScope = dashboard && scope === "corpus" ? corpus() : genreScope;
  const periodResultScope = dashboard && scope === "corpus" ? corpus() : periodScope;
  const languageResultScope = dashboard && scope === "corpus" ? corpus() : languageScope;
  const textTypeResultScope = dashboard && scope === "corpus" ? corpus() : textTypeScope;

  const compatibleFacetsPromise =
    dashboard && scope === "corpus"
      ? getMetadataFacets(normalizedFilters, { dashboard: false })
      : Promise.resolve<MetadataFacets>({
          authors: [],
          works: [],
          genres: [],
          periods: [],
          languages: [],
          textTypes: []
        });

  const authorLimited = dashboard ? `LIMIT ${topLimit}` : "";
  const workLimited = dashboard ? `LIMIT ${topLimit}` : "";
  const selectedFacet = options.facet;
  const emptyFacets: MetadataFacets = { authors: [], works: [], genres: [], periods: [], languages: [], textTypes: [] };

  function shouldFetch(facet: keyof MetadataFacets) {
    return !selectedFacet || selectedFacet === facet;
  }

  const authorScopeForQuery = addFacetQuery(authorResultScope, "a.name");
  const workScopeForQuery = addFacetQuery(workResultScope, "w.title");

  const [authors, works, genres, periods, languages, textTypes, compatibleFacets] = await Promise.all([
    shouldFetch("authors") ? getPool().query<FacetOption>(`
      SELECT a.id, a.name AS label, count(DISTINCT n.id)::int AS count
      FROM authors a
      JOIN published_passages p ON p.author_id = a.id
      JOIN works w ON w.id = p.work_id
      WHERE ${authorScopeForQuery.where}
      GROUP BY a.id, a.name
      ORDER BY ${dashboard ? "count DESC, a.name" : "a.name"}
      ${authorLimited}
    `.replace("count(DISTINCT n.id)::int", "count(DISTINCT p.work_id)::int"), authorScopeForQuery.values) : Promise.resolve({ rows: emptyFacets.authors }),
    shouldFetch("works") ? getPool().query<FacetOption>(`
      SELECT w.id, w.title AS label, w.author_id, count(DISTINCT n.id)::int AS count
      FROM works w
      JOIN published_passages p ON p.work_id = w.id
      JOIN authors a ON a.id = p.author_id
      LEFT JOIN published_nodes n ON n.work_id = w.id AND n.level = 'work'
      WHERE ${workScopeForQuery.where}
      GROUP BY w.id, w.title, w.author_id
      ORDER BY w.title
      ${workLimited}
    `, workScopeForQuery.values) : Promise.resolve({ rows: emptyFacets.works }),
    shouldFetch("genres") ? getPool().query<FacetOption>(`
      SELECT p.genre AS id, p.genre AS label, count(DISTINCT p.work_id)::int AS count
      FROM published_passages p
      JOIN authors a ON a.id = p.author_id
      JOIN works w ON w.id = p.work_id
      WHERE p.genre IS NOT NULL AND ${genreResultScope.where}
      GROUP BY p.genre
      ORDER BY p.genre
    `, genreResultScope.values) : Promise.resolve({ rows: emptyFacets.genres }),
    shouldFetch("periods") ? getPool().query<FacetOption>(`
      SELECT p.period AS id, p.period AS label, count(*)::int AS count
      FROM published_passages p
      JOIN authors a ON a.id = p.author_id
      JOIN works w ON w.id = p.work_id
      WHERE p.period IS NOT NULL AND ${periodResultScope.where}
      GROUP BY p.period
      ORDER BY CASE lower(p.period)
        WHEN 'archaic' THEN 1
        WHEN 'classical' THEN 2
        WHEN 'hellenistic' THEN 3
        WHEN 'roman' THEN 4
        ELSE 99
      END, p.period
    `, periodResultScope.values) : Promise.resolve({ rows: emptyFacets.periods }),
    shouldFetch("languages") ? getPool().query<FacetOption>(`
      SELECT p.language AS id, p.language AS label, count(*)::int AS count
      FROM published_passages p
      JOIN authors a ON a.id = p.author_id
      JOIN works w ON w.id = p.work_id
      WHERE p.language IS NOT NULL AND ${languageResultScope.where}
      GROUP BY p.language
      ORDER BY p.language
    `, languageResultScope.values) : Promise.resolve({ rows: emptyFacets.languages }),
    shouldFetch("textTypes") ? getPool().query<FacetOption>(`
      SELECT p.text_type AS id, p.text_type AS label, count(*)::int AS count
      FROM published_passages p
      JOIN authors a ON a.id = p.author_id
      JOIN works w ON w.id = p.work_id
      WHERE p.text_type IS NOT NULL AND ${textTypeResultScope.where}
      GROUP BY p.text_type
      ORDER BY p.text_type
    `, textTypeResultScope.values) : Promise.resolve({ rows: emptyFacets.textTypes }),
    compatibleFacetsPromise
  ]);

  const rawFacets = {
    authors: authors.rows,
    works: works.rows,
    genres: genres.rows,
    periods: periods.rows,
    languages: languages.rows,
    textTypes: textTypes.rows
  };

  if (!dashboard) {
    return rawFacets;
  }

  const compatibilitySource = scope === "corpus" ? compatibleFacets : rawFacets;

  return {
    authors: markFacetOptions(rawFacets.authors, new Set(compatibilitySource.authors.map((option) => option.id)), normalizedFilters, "author"),
    works: markFacetOptions(rawFacets.works, new Set(compatibilitySource.works.map((option) => option.id)), normalizedFilters, "work"),
    genres: markFacetOptions(rawFacets.genres, new Set(compatibilitySource.genres.map((option) => option.id)), normalizedFilters, "genre"),
    periods: markFacetOptions(rawFacets.periods, new Set(compatibilitySource.periods.map((option) => option.id)), normalizedFilters, "period"),
    languages: markFacetOptions(rawFacets.languages, new Set(compatibilitySource.languages.map((option) => option.id)), normalizedFilters, "language"),
    textTypes: markFacetOptions(rawFacets.textTypes, new Set(compatibilitySource.textTypes.map((option) => option.id)), normalizedFilters, "textType")
  };
}

export async function getMetadataSummary(filters: SearchFilters = {}): Promise<MetadataSummary> {
  const normalizedFilters = normalizeSearchFilters(filters);
  const values: unknown[] = [];
  const where = ["p.license_status = 'cc_compatible'"];
  addPassageSqlFilters(where, values, normalizedFilters);
  const result = await getPool().query<MetadataSummary>(`
    SELECT
      count(DISTINCT p.author_id)::int AS authors_count,
      count(DISTINCT p.work_id)::int AS works_count,
      count(*)::int AS passages_count
    FROM published_passages p
    JOIN authors a ON a.id = p.author_id
    JOIN works w ON w.id = p.work_id
    WHERE ${where.join(" AND ")}
  `, values);
  return result.rows[0] ?? { authors_count: 0, works_count: 0, passages_count: 0 };
}

export async function getNodes(level: NodeLevel = "author", filters: SearchFilters = {}): Promise<SemanticNode[]> {
  const values: unknown[] = [level];
  const where = ["n.license_status = 'cc_compatible'", "n.level = $1"];
  addNodeSqlFilters(where, values, filters);
  const result = await getPool().query<SemanticNode>(`
    SELECT ${NODE_SELECT}
    FROM published_nodes n
    LEFT JOIN published_passages p ON p.id = n.passage_id
    LEFT JOIN works w ON w.id = n.work_id
    LEFT JOIN authors a ON a.id = n.author_id
    WHERE ${where.join(" AND ")}
  `, values);
  return result.rows;
}

export async function getSampledNodes(
  level: NodeLevel = "author",
  filters: SearchFilters = {},
  limit = 1000
): Promise<SemanticNode[]> {
  const values: unknown[] = [level, Math.min(Math.max(Math.floor(limit), 1), 1000)];
  const where = ["n.license_status = 'cc_compatible'", "n.level = $1"];
  addNodeSqlFilters(where, values, filters);
  const result = await getPool().query<SemanticNode>(`
    SELECT ${NODE_SELECT}
    FROM published_nodes n
    LEFT JOIN published_passages p ON p.id = n.passage_id
    LEFT JOIN works w ON w.id = n.work_id
    LEFT JOIN authors a ON a.id = n.author_id
    WHERE ${where.join(" AND ")}
    ORDER BY n.id
    LIMIT $2
  `, values);
  return result.rows;
}

export async function getNodesForResultSet(level: NodeLevel = "author", results: Passage[] = []): Promise<SemanticNode[]> {
  if (!results.length) {
    return [];
  }

  const ids =
    level === "author"
      ? [...new Set(results.map((passage) => passage.author_id).filter(Boolean) as string[])]
      : level === "work"
        ? [...new Set(results.map((passage) => passage.work_id).filter(Boolean) as string[])]
        : [...new Set(results.map((passage) => passage.id).filter(Boolean))];

  if (!ids.length) {
    return [];
  }

  const predicate =
    level === "author"
      ? "n.author_id = ANY($2::text[])"
      : level === "work"
        ? "n.work_id = ANY($2::text[])"
        : "(n.passage_id = ANY($2::text[]) OR n.id = ANY($2::text[]))";

  const result = await getPool().query<SemanticNode>(`
    SELECT ${NODE_SELECT}
    FROM published_nodes n
    LEFT JOIN published_passages p ON p.id = n.passage_id
    LEFT JOIN works w ON w.id = n.work_id
    LEFT JOIN authors a ON a.id = n.author_id
    WHERE n.license_status = 'cc_compatible'
      AND n.level = $1
      AND ${predicate}
  `, [level, ids]);
  return result.rows;
}
