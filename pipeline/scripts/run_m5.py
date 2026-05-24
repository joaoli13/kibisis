from __future__ import annotations

from pathlib import Path

from m5_exporter.publish_views import assert_json_view_ids_match, assert_no_license_leaks, refresh_publish_views
from m5_exporter.static_json import export_static_json
from perseus_pipeline.db import connect


def _rows(conn, query: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(query)
        columns = [desc.name for desc in cur.description or []]
        return [dict(zip(columns, row, strict=True)) for row in cur.fetchall()]


def main() -> None:
    output_dir = Path(__file__).resolve().parents[2] / "app" / "public" / "data"
    with connect() as conn:
        refresh_publish_views(conn)
        assert_no_license_leaks(conn)
        passages = _rows(
            conn,
            """
            SELECT
              p.id, p.cts_urn, p.passage_ref, p.text, p.author_id, p.work_id, p.genre, p.period,
              p.language, p.text_type, p.cluster_id, p.source_url, p.license_status, w.date_hint AS work_date
            FROM published_passages p
            JOIN works w ON w.id = p.work_id
            ORDER BY p.id
            """,
        )
        nodes = _rows(
            conn,
            """
            SELECT
              n.id, n.parent_id, n.level, n.passage_id, n.author_id, n.work_id, n.cluster_id,
              n.genre, n.period, n.language, n.token_count, n.umap_3d, n.license_status,
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
            FROM published_nodes n
            LEFT JOIN published_passages p ON p.id = n.passage_id
            LEFT JOIN works w ON w.id = n.work_id
            LEFT JOIN authors a ON a.id = n.author_id
            ORDER BY n.id
            """,
        )
        clusters = _rows(conn, "SELECT id, scope, label, topics FROM clusters ORDER BY id")
        authors = _rows(conn, "SELECT id, name, name_variants, wikidata_id, period FROM authors ORDER BY name")
        metadata = _rows(conn, "SELECT value FROM dataset_metadata WHERE key = 'dataset_snapshot'")
        snapshot = None
        if metadata and isinstance(metadata[0]["value"], dict):
            snapshot = metadata[0]["value"].get("dataset_snapshot")
    export_static_json(output_dir, passages, nodes, clusters, authors, snapshot)
    with connect() as conn:
        assert_json_view_ids_match(
            conn,
            {str(passage["id"]) for passage in passages},
            {str(node["id"]) for node in nodes},
        )
    print(f"Exported static fallback JSON to {output_dir}")


if __name__ == "__main__":
    main()
