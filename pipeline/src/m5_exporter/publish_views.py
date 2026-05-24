from __future__ import annotations

from psycopg import Connection

from m3_embedder.aggregator import aggregate_embeddings
from m3_embedder.db_embedder import parse_vector, vector_literal


def refresh_publish_views(conn: Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            DO $$
            DECLARE rel record;
            BEGIN
              FOR rel IN
                SELECT relname, relkind
                FROM pg_class
                WHERE relname IN ('published_nodes', 'published_passages')
                  AND relnamespace = 'public'::regnamespace
              LOOP
                IF rel.relkind = 'v' THEN
                  EXECUTE format('DROP VIEW IF EXISTS %I', rel.relname);
                ELSE
                  EXECUTE format('DROP TABLE IF EXISTS %I', rel.relname);
                END IF;
              END LOOP;
            END $$;
            """
        )
        cur.execute(
            """
            CREATE TABLE published_passages AS
            SELECT * FROM passages
            WHERE license_status = 'cc_compatible'
            """
        )
        cur.execute(
            """
            CREATE TABLE published_nodes AS
            SELECT * FROM semantic_nodes
            WHERE license_status = 'cc_compatible'
            """
        )
        cur.execute("CREATE INDEX published_passages_id_idx ON published_passages(id)")
        cur.execute("CREATE INDEX published_passages_tsv_idx ON published_passages USING gin(tsv)")
        cur.execute("CREATE INDEX published_nodes_id_idx ON published_nodes(id)")
        cur.execute("CREATE INDEX published_nodes_level_idx ON published_nodes(level)")
        cur.execute("CREATE INDEX published_nodes_parent_idx ON published_nodes(parent_id)")
        cur.execute(
            """
            CREATE INDEX published_nodes_embedding_hnsw_idx
            ON published_nodes USING hnsw (embedding vector_cosine_ops)
            WHERE embedding IS NOT NULL
            """
        )
        cur.execute(
            """
            INSERT INTO dataset_metadata(key, value, updated_at)
            VALUES ('dataset_snapshot', jsonb_build_object('dataset_snapshot', current_date::text), now())
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
            """
        )
    recompute_published_aggregates(conn)


def recompute_published_aggregates(conn: Connection) -> None:
    aggregates = conn.execute(
        """
        SELECT id
        FROM published_nodes
        WHERE level IN ('section', 'chapter', 'book', 'work', 'author')
        ORDER BY level
        """
    ).fetchall()
    for (node_id,) in aggregates:
        descendants = conn.execute(
            """
            WITH RECURSIVE tree AS (
              SELECT id, parent_id, level, embedding, token_count
              FROM published_nodes
              WHERE id = %s
              UNION ALL
              SELECT child.id, child.parent_id, child.level, child.embedding, child.token_count
              FROM published_nodes child
              JOIN tree parent ON child.parent_id = parent.id
            )
            SELECT embedding::text, token_count
            FROM tree
            WHERE level = 'passage' AND embedding IS NOT NULL
            """,
            (node_id,),
        ).fetchall()
        if not descendants:
            conn.execute("DELETE FROM published_nodes WHERE id = %s", (node_id,))
            continue
        embedding = aggregate_embeddings(
            [(parse_vector(vector_text), int(token_count or 0)) for vector_text, token_count in descendants]
        )
        conn.execute(
            """
            UPDATE published_nodes
            SET embedding = %s::vector,
                aggregation_method = 'token_weighted_mean',
                license_status = 'cc_compatible'
            WHERE id = %s
            """,
            (vector_literal(embedding), node_id),
        )


def assert_no_license_leaks(conn: Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM published_passages WHERE license_status != 'cc_compatible'")
        passage_leaks = cur.fetchone()[0]
        cur.execute(
            """
            SELECT count(*) FROM published_nodes
            WHERE license_status NOT IN ('cc_compatible') AND level = 'passage'
            """
        )
        node_leaks = cur.fetchone()[0]
    if passage_leaks or node_leaks:
        raise RuntimeError(f"License leak detected: passages={passage_leaks}, nodes={node_leaks}")


def assert_json_view_ids_match(conn: Connection, passage_ids: set[str], node_ids: set[str]) -> None:
    view_passage_ids = {row[0] for row in conn.execute("SELECT id FROM published_passages").fetchall()}
    view_node_ids = {row[0] for row in conn.execute("SELECT id FROM published_nodes").fetchall()}
    if passage_ids != view_passage_ids:
        raise RuntimeError(
            f"Published passage JSON mismatch: json={len(passage_ids)} db={len(view_passage_ids)}"
        )
    if node_ids != view_node_ids:
        raise RuntimeError(f"Published node JSON mismatch: json={len(node_ids)} db={len(view_node_ids)}")
