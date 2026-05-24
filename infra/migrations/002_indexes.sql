CREATE INDEX IF NOT EXISTS passages_tsv_gin_idx ON passages USING gin (tsv);
CREATE INDEX IF NOT EXISTS semantic_nodes_embedding_hnsw_idx
  ON semantic_nodes USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS semantic_nodes_level_idx ON semantic_nodes(level);
CREATE INDEX IF NOT EXISTS semantic_nodes_parent_id_idx ON semantic_nodes(parent_id);
CREATE INDEX IF NOT EXISTS semantic_nodes_author_id_idx ON semantic_nodes(author_id);
CREATE INDEX IF NOT EXISTS semantic_nodes_work_id_idx ON semantic_nodes(work_id);
CREATE INDEX IF NOT EXISTS semantic_nodes_license_status_idx ON semantic_nodes(license_status);

CREATE INDEX IF NOT EXISTS passages_author_id_idx ON passages(author_id);
CREATE INDEX IF NOT EXISTS passages_cluster_id_idx ON passages(cluster_id);
CREATE INDEX IF NOT EXISTS passages_language_idx ON passages(language);
CREATE INDEX IF NOT EXISTS passages_license_status_idx ON passages(license_status);

