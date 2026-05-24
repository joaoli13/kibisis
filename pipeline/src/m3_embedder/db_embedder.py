from __future__ import annotations

from pathlib import Path

from psycopg import Connection

from m3_embedder.aggregator import aggregate_embeddings
from m3_embedder.cache import read_cached_embedding, write_cached_embedding
from m3_embedder.embedding_text import EMBEDDING_INPUT_VERSION, build_embedding_text
from m3_embedder.gemini import embed_texts


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.9f}" for value in values) + "]"


def parse_vector(value: str) -> list[float]:
    return [float(part) for part in value.strip("[]").split(",") if part]


def is_quota_error(error: Exception) -> bool:
    text = f"{type(error).__name__}: {error}"
    return "ResourceExhausted" in text or "429" in text or "quota" in text.lower()


def update_leaf_embedding(conn: Connection, node_id: str, embedding: list[float]) -> None:
    if len(embedding) != 768:
        raise RuntimeError(f"Refusing to persist non-768D embedding for {node_id}")
    conn.execute(
        """
        UPDATE semantic_nodes
        SET embedding = %s::vector,
            aggregation_method = 'leaf',
            metadata = jsonb_set(metadata, '{embedding_input_version}', to_jsonb(%s::text), true),
            updated_at = now()
        WHERE id = %s
        """,
        (vector_literal(embedding), EMBEDDING_INPUT_VERSION, node_id),
    )


def embed_leaf_nodes(conn: Connection, cache_dir: Path, limit: int | None = None, force: bool = False) -> tuple[int, str | None]:
    query = """
        SELECT
          n.id,
          p.text,
          p.passage_ref,
          p.language,
          p.text_type,
          p.genre,
          p.period,
          p.metadata,
          a.name AS author,
          w.title AS work
        FROM semantic_nodes n
        JOIN passages p ON p.id = n.passage_id
        JOIN authors a ON a.id = p.author_id
        JOIN works w ON w.id = p.work_id
        WHERE n.level = 'passage'
          AND n.license_status = 'cc_compatible'
          AND (
            n.embedding IS NULL
            OR (%s AND COALESCE(n.metadata->>'embedding_input_version', '') != %s)
          )
        ORDER BY n.id
    """
    params: tuple[object, ...] = (force, EMBEDDING_INPUT_VERSION)
    if limit is not None:
        query += " LIMIT %s"
        params = (force, EMBEDDING_INPUT_VERSION, limit)
    rows = conn.execute(query, params).fetchall()
    updated = 0
    stop_reason = None
    pending: list[tuple[str, str]] = []

    def flush_pending() -> bool:
        nonlocal updated, stop_reason, pending
        if not pending:
            return True
        try:
            embeddings = embed_texts([embedding_input for _, embedding_input in pending])
        except Exception as error:
            if is_quota_error(error):
                stop_reason = "gemini_quota_exhausted"
                return False
            raise
        for (node_id, embedding_input), embedding in zip(pending, embeddings, strict=True):
            write_cached_embedding(cache_dir, embedding_input, embedding)
            update_leaf_embedding(conn, node_id, embedding)
            updated += 1
        conn.commit()
        pending = []
        return True

    for row in rows:
        node_id = row[0]
        embedding_input = build_embedding_text(
            {
                "text": row[1],
                "passage_ref": row[2],
                "language": row[3],
                "text_type": row[4],
                "genre": row[5],
                "period": row[6],
                "metadata": row[7],
                "author": row[8],
                "work": row[9],
            }
        )
        embedding = read_cached_embedding(cache_dir, embedding_input)
        if embedding is None:
            pending.append((node_id, embedding_input))
            if len(pending) >= 100 and not flush_pending():
                break
            continue
        update_leaf_embedding(conn, node_id, embedding)
        conn.commit()
        updated += 1
    if not stop_reason:
        flush_pending()
    return updated, stop_reason


def aggregate_level(conn: Connection, level: str) -> int:
    parents = conn.execute(
        """
        SELECT id
        FROM semantic_nodes
        WHERE level = %s AND license_status = 'cc_compatible'
        ORDER BY length(id) DESC, id DESC
        """,
        (level,),
    ).fetchall()
    updated = 0
    for (parent_id,) in parents:
        children = conn.execute(
            """
            SELECT embedding::text, token_count
            FROM semantic_nodes
            WHERE parent_id = %s
              AND embedding IS NOT NULL
              AND license_status = 'cc_compatible'
            ORDER BY id
            """,
            (parent_id,),
        ).fetchall()
        if not children:
            continue
        embedding = aggregate_embeddings(
            [(parse_vector(vector_text), int(token_count or 0)) for vector_text, token_count in children]
        )
        if len(embedding) != 768:
            raise RuntimeError(f"Refusing to persist non-768D aggregate for {parent_id}")
        conn.execute(
            """
            UPDATE semantic_nodes
            SET embedding = %s::vector,
                aggregation_method = 'token_weighted_mean',
                updated_at = now()
            WHERE id = %s
            """,
            (vector_literal(embedding), parent_id),
        )
        updated += 1
    return updated


def aggregate_all(conn: Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for level in ("section", "chapter", "book", "work", "author"):
        counts[level] = aggregate_level(conn, level)
    return counts
