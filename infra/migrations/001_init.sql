CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_variants TEXT[] NOT NULL DEFAULT '{}',
  wikidata_id TEXT,
  period TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors(id),
  title TEXT NOT NULL,
  cts_urn TEXT,
  genre TEXT,
  period TEXT,
  date_hint TEXT,
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  cts_urn TEXT,
  language TEXT NOT NULL,
  text_type TEXT NOT NULL DEFAULT 'translation',
  source_path TEXT NOT NULL,
  source_url TEXT,
  edition_year INTEGER,
  translator TEXT,
  license_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (license_status IN ('cc_compatible', 'restricted', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  label TEXT,
  topics TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passages (
  id TEXT PRIMARY KEY,
  edition_id TEXT REFERENCES editions(id),
  author_id TEXT NOT NULL REFERENCES authors(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  cluster_id TEXT REFERENCES clusters(id),
  cts_urn TEXT NOT NULL,
  passage_ref TEXT NOT NULL,
  passage_ref_synthetic BOOLEAN NOT NULL DEFAULT false,
  text TEXT NOT NULL,
  language TEXT NOT NULL,
  text_type TEXT NOT NULL DEFAULT 'translation',
  genre TEXT,
  period TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  source_path TEXT,
  source_url TEXT,
  license_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (license_status IN ('cc_compatible', 'restricted', 'unknown')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(text, ''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semantic_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES semantic_nodes(id) ON DELETE CASCADE,
  level TEXT NOT NULL
    CHECK (level IN ('passage', 'section', 'chapter', 'book', 'work', 'author')),
  cts_urn TEXT,
  passage_ref_range TEXT,
  author_id TEXT REFERENCES authors(id),
  work_id TEXT REFERENCES works(id),
  passage_id TEXT REFERENCES passages(id) ON DELETE CASCADE,
  cluster_id TEXT REFERENCES clusters(id),
  text_type TEXT,
  language TEXT,
  genre TEXT,
  period TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding vector(768),
  umap_3d DOUBLE PRECISION[],
  aggregation_method TEXT NOT NULL DEFAULT 'token_weighted_mean',
  license_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (license_status IN ('cc_compatible', 'restricted', 'unknown')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses_audit (
  id BIGSERIAL PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  declared_license TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('cc_compatible', 'restricted', 'unknown')),
  decision_reason TEXT NOT NULL,
  license_source TEXT NOT NULL
    CHECK (license_source IN ('overrides', 'tei_header', 'repo_license_file', 'repo_readme', 'default')),
  edition_year INTEGER,
  translator TEXT,
  is_public_domain_original BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_metadata (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
