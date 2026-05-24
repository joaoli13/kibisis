from __future__ import annotations

from pathlib import Path

from m1_ingestor.catalog import _work_catalog
from m5_exporter.static_json import export_static_json
from perseus_pipeline.db import connect


LANGUAGE_PATTERN = r"-(grc|lat|eng|fre|ger|ita|spa|ara)[0-9]*(?=(:|$|\.))"


def _text_type_expression(language_expression: str) -> str:
    return f"CASE WHEN {language_expression} IN ('grc', 'lat') THEN 'original' ELSE 'translation' END"


def _rows(conn, query: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(query)
        columns = [desc.name for desc in cur.description or []]
        return [dict(zip(columns, row, strict=True)) for row in cur.fetchall()]


def _relation_kind(conn, relation: str) -> str | None:
    row = conn.execute(
        """
        SELECT relkind
        FROM pg_class
        WHERE relname = %s
          AND relnamespace = 'public'::regnamespace
        """,
        (relation,),
    ).fetchone()
    return row[0] if row else None


def _relation_exists(conn, relation: str) -> bool:
    return _relation_kind(conn, relation) is not None


def _relation_is_table(conn, relation: str) -> bool:
    return _relation_kind(conn, relation) in {"r", "p", "m"}


def _ensure_work_date_column(conn) -> None:
    conn.execute("ALTER TABLE works ADD COLUMN IF NOT EXISTS date_hint TEXT")


def _update_work_dates(conn) -> int:
    _ensure_work_date_column(conn)
    updates = [
        (f"work:greekLit:{key}", record.date_hint)
        for key, record in _work_catalog().items()
        if record.date_hint
    ]
    if not updates:
        return 0
    updated = 0
    for work_id, date_hint in updates:
        result = conn.execute(
            """
            UPDATE works
            SET date_hint = %s
            WHERE id = %s
              AND date_hint IS DISTINCT FROM %s
            """,
            (date_hint, work_id, date_hint),
        )
        updated += int(result.rowcount or 0)
    return updated


def _update_passage_relation(conn, relation: str) -> int:
    language_expression = "derived.language"
    result = conn.execute(
        f"""
        WITH derived AS (
          SELECT id, (regexp_match(cts_urn, %s))[1] AS language
          FROM {relation}
          WHERE cts_urn ~ %s
        )
        UPDATE {relation} p
        SET language = {language_expression},
            text_type = {_text_type_expression(language_expression)},
            updated_at = now()
        FROM derived
        WHERE p.id = derived.id
          AND derived.language IS NOT NULL
          AND (
            p.language IS DISTINCT FROM derived.language
            OR p.text_type IS DISTINCT FROM {_text_type_expression(language_expression)}
          )
        """,
        (LANGUAGE_PATTERN, LANGUAGE_PATTERN),
    )
    return int(result.rowcount or 0)


def _update_edition_metadata(conn) -> int:
    language_expression = "derived.language"
    result = conn.execute(
        f"""
        WITH derived AS (
          SELECT id, (regexp_match(cts_urn, %s))[1] AS language
          FROM editions
          WHERE cts_urn ~ %s
        )
        UPDATE editions e
        SET language = {language_expression},
            text_type = {_text_type_expression(language_expression)}
        FROM derived
        WHERE e.id = derived.id
          AND derived.language IS NOT NULL
          AND (
            e.language IS DISTINCT FROM derived.language
            OR e.text_type IS DISTINCT FROM {_text_type_expression(language_expression)}
          )
        """,
        (LANGUAGE_PATTERN, LANGUAGE_PATTERN),
    )
    return int(result.rowcount or 0)


def _update_work_languages(conn) -> int:
    result = conn.execute(
        """
        UPDATE works
        SET language = CASE
          WHEN cts_urn LIKE 'urn:cts:greekLit:%' THEN 'grc'
          WHEN cts_urn LIKE 'urn:cts:latinLit:%' THEN 'lat'
          ELSE language
        END
        WHERE (
          cts_urn LIKE 'urn:cts:greekLit:%'
          AND language IS DISTINCT FROM 'grc'
        )
        OR (
          cts_urn LIKE 'urn:cts:latinLit:%'
          AND language IS DISTINCT FROM 'lat'
        )
        """
    )
    return int(result.rowcount or 0)


def _update_node_relation(conn, node_relation: str, passage_relation: str) -> int:
    leaf_result = conn.execute(
        f"""
        UPDATE {node_relation} n
        SET language = p.language,
            text_type = p.text_type
        FROM {passage_relation} p
        WHERE n.level = 'passage'
          AND n.passage_id = p.id
          AND (
            n.language IS DISTINCT FROM p.language
            OR n.text_type IS DISTINCT FROM p.text_type
          )
        """
    )
    language_expression = "derived.language"
    ancestor_result = conn.execute(
        f"""
        WITH derived AS (
          SELECT id, (regexp_match(cts_urn, %s))[1] AS language
          FROM {node_relation}
          WHERE level <> 'passage'
            AND cts_urn ~ %s
        )
        UPDATE {node_relation} n
        SET language = {language_expression},
            text_type = {_text_type_expression(language_expression)}
        FROM derived
        WHERE n.id = derived.id
          AND derived.language IS NOT NULL
          AND (
            n.language IS DISTINCT FROM derived.language
            OR n.text_type IS DISTINCT FROM {_text_type_expression(language_expression)}
          )
        """,
        (LANGUAGE_PATTERN, LANGUAGE_PATTERN),
    )
    return int(leaf_result.rowcount or 0) + int(ancestor_result.rowcount or 0)


def _published_passage_relation(conn) -> str:
    if _relation_exists(conn, "published_passages"):
        return "published_passages"
    return "passages"


def _published_node_relation(conn) -> str:
    if _relation_exists(conn, "published_nodes"):
        return "published_nodes"
    return "semantic_nodes"


def _export_json(conn) -> None:
    passage_relation = _published_passage_relation(conn)
    node_relation = _published_node_relation(conn)
    passage_filter = "" if passage_relation == "published_passages" else "WHERE p.license_status = 'cc_compatible'"
    node_filter = "" if node_relation == "published_nodes" else "WHERE n.license_status = 'cc_compatible'"
    output_dir = Path(__file__).resolve().parents[2] / "app" / "public" / "data"
    passages = _rows(
        conn,
        f"""
        SELECT
          p.id, p.cts_urn, p.passage_ref, p.text, p.author_id, p.work_id, p.genre, p.period,
          p.language, p.text_type, p.cluster_id, p.source_url, p.license_status, w.date_hint AS work_date
        FROM {passage_relation} p
        JOIN works w ON w.id = p.work_id
        {passage_filter}
        ORDER BY p.id
        """,
    )
    nodes = _rows(
        conn,
        f"""
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
        FROM {node_relation} n
        LEFT JOIN {passage_relation} p ON p.id = n.passage_id
        LEFT JOIN works w ON w.id = n.work_id
        LEFT JOIN authors a ON a.id = n.author_id
        {node_filter}
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
    print(f"Exported static JSON to {output_dir}")


def _sample(conn) -> dict | None:
    relation = _published_passage_relation(conn)
    rows = _rows(
        conn,
        f"""
        SELECT id, cts_urn, language, text_type
        FROM {relation}
        WHERE cts_urn = 'urn:cts:greekLit:tlg0074.tlg001.perseus-grc2:6.26.3-6.28.5'
        LIMIT 1
        """,
    )
    return rows[0] if rows else None


def main() -> None:
    with connect() as conn:
        counts: dict[str, int] = {
            "work_dates": _update_work_dates(conn),
            "editions": _update_edition_metadata(conn),
            "works": _update_work_languages(conn),
            "passages": _update_passage_relation(conn, "passages"),
            "semantic_nodes": _update_node_relation(conn, "semantic_nodes", "passages"),
        }
        if _relation_is_table(conn, "published_passages"):
            counts["published_passages"] = _update_passage_relation(conn, "published_passages")
        if _relation_is_table(conn, "published_nodes"):
            counts["published_nodes"] = _update_node_relation(conn, "published_nodes", _published_passage_relation(conn))
        _export_json(conn)
        sample = _sample(conn)
        print("Updated rows:", counts)
        print("Arrian sample:", sample)


if __name__ == "__main__":
    main()
