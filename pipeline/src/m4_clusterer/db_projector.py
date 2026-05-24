from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass

import numpy as np
from psycopg import Connection

from m3_embedder.db_embedder import parse_vector


STOPWORDS = {
    "about",
    "after",
    "again",
    "against",
    "also",
    "and",
    "are",
    "because",
    "been",
    "being",
    "but",
    "could",
    "from",
    "have",
    "into",
    "not",
    "only",
    "shall",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "upon",
    "were",
    "when",
    "which",
    "while",
    "with",
    "would",
}


@dataclass(frozen=True)
class LeafRow:
    node_id: str
    passage_id: str
    language: str | None
    genre: str | None
    text: str
    embedding: list[float]


@dataclass(frozen=True)
class AggregateRow:
    node_id: str
    level: str
    embedding: list[float]


def _load_leaf_rows(conn: Connection) -> list[LeafRow]:
    rows = conn.execute(
        """
        SELECT n.id, n.passage_id, n.language, n.genre, p.text, n.embedding::text
        FROM semantic_nodes n
        JOIN passages p ON p.id = n.passage_id
        WHERE n.level = 'passage'
          AND n.embedding IS NOT NULL
          AND n.license_status = 'cc_compatible'
        ORDER BY n.id
        """
    ).fetchall()
    return [
        LeafRow(
            node_id=row[0],
            passage_id=row[1],
            language=row[2],
            genre=row[3],
            text=row[4],
            embedding=parse_vector(row[5]),
        )
        for row in rows
    ]


def _load_aggregate_rows(conn: Connection) -> list[AggregateRow]:
    rows = conn.execute(
        """
        SELECT id, level, embedding::text
        FROM semantic_nodes
        WHERE level IN ('section', 'chapter', 'book', 'work', 'author')
          AND embedding IS NOT NULL
          AND license_status = 'cc_compatible'
        ORDER BY level, id
        """
    ).fetchall()
    return [AggregateRow(node_id=row[0], level=row[1], embedding=parse_vector(row[2])) for row in rows]


def _fit_umap(vectors: np.ndarray, n_components: int, random_state: int):
    import umap

    n_neighbors = min(15, max(2, len(vectors) - 1))
    reducer = umap.UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        min_dist=0.05,
        metric="cosine",
        random_state=random_state,
        transform_seed=random_state,
    )
    reducer.fit(vectors)
    return reducer


def _cluster(vectors_50d: np.ndarray) -> list[int]:
    import hdbscan

    min_cluster_size = max(5, min(30, len(vectors_50d) // 25))
    min_samples = max(2, min(10, min_cluster_size // 2))
    model = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        prediction_data=False,
    )
    return [int(label) for label in model.fit_predict(vectors_50d)]


def _tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z'-]{3,}", text.lower())
        if token not in STOPWORDS
    ]


def _topics(rows: list[LeafRow], labels: list[int], top_n: int = 8) -> dict[int, list[str]]:
    cluster_doc_freq: dict[int, Counter[str]] = defaultdict(Counter)
    global_doc_freq: Counter[str] = Counter()
    cluster_sizes: Counter[int] = Counter(labels)
    for row, label in zip(rows, labels, strict=True):
        unique = set(_tokenize(row.text))
        global_doc_freq.update(unique)
        cluster_doc_freq[label].update(unique)
    total_docs = max(1, len(rows))
    topics: dict[int, list[str]] = {}
    for label, counts in cluster_doc_freq.items():
        scored = []
        for term, count in counts.items():
            idf = np.log((1 + total_docs) / (1 + global_doc_freq[term])) + 1
            tf = count / max(1, cluster_sizes[label])
            scored.append((term, tf * idf))
        topics[label] = [term for term, _ in sorted(scored, key=lambda item: item[1], reverse=True)[:top_n]]
    return topics


def _insert_cluster(
    conn: Connection,
    cluster_id: str,
    scope: str,
    label: str | None,
    topics: list[str],
) -> None:
    conn.execute(
        """
        INSERT INTO clusters(id, scope, label, topics)
        VALUES (%s, %s, %s, %s)
        """,
        (cluster_id, scope, label, topics),
    )


def _insert_scoped_clusters(
    conn: Connection,
    rows: list[LeafRow],
    vectors_50d: np.ndarray,
    field: str,
) -> int:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        value = getattr(row, field)
        if value:
            groups[str(value)].append(index)

    inserted = 0
    for value, indices in sorted(groups.items()):
        if len(indices) < 10:
            continue
        subset_vectors = vectors_50d[indices]
        subset_rows = [rows[index] for index in indices]
        labels = _cluster(subset_vectors)
        topic_map = _topics(subset_rows, labels)
        counts = Counter(labels)
        for label, count in sorted(counts.items()):
            cluster_id = f"hdbscan:{field}:{value}:{label}"
            cluster_label = (
                f"{field} {value} noise"
                if label == -1
                else f"{field} {value} cluster {label}"
            )
            _insert_cluster(
                conn,
                cluster_id,
                f"{field}:{value}",
                cluster_label,
                topic_map.get(label, [f"{count} passages"]),
            )
            inserted += 1
    return inserted


def _insert_aggregate_level_clusters(
    conn: Connection,
    rows: list[AggregateRow],
    level: str,
    random_state: int,
) -> int:
    subset = [row for row in rows if row.level == level]
    if len(subset) < 3:
        return 0

    vectors = np.array([row.embedding for row in subset], dtype=np.float32)
    components = min(50, max(2, len(subset) - 2))
    reducer = _fit_umap(vectors, components, random_state)
    vectors_50d = reducer.transform(vectors)
    labels = _cluster(vectors_50d)
    counts = Counter(labels)

    for label in sorted(counts):
        cluster_id = f"hdbscan:{level}:{label}"
        _insert_cluster(conn, cluster_id, level, None, [])

    for row, label in zip(subset, labels, strict=True):
        conn.execute(
            """
            UPDATE semantic_nodes
            SET cluster_id = %s, updated_at = now()
            WHERE id = %s
            """,
            (f"hdbscan:{level}:{label}", row.node_id),
        )
    return len(counts)


def _reset_cluster_outputs(conn: Connection) -> None:
    conn.execute("UPDATE passages SET cluster_id = NULL")
    conn.execute("UPDATE semantic_nodes SET cluster_id = NULL, umap_3d = NULL")
    conn.execute("DELETE FROM clusters")


def project_embedded_nodes(conn: Connection, random_state: int = 42) -> dict[str, int]:
    leaves = _load_leaf_rows(conn)
    if len(leaves) < 3:
        return {"projected": 0, "clusters": 0, "leaf_clusters": 0, "aggregate_projected": 0}

    _reset_cluster_outputs(conn)

    leaf_vectors = np.array([row.embedding for row in leaves], dtype=np.float32)
    cluster_components = min(50, max(2, len(leaves) - 2))
    reducer_50d = _fit_umap(leaf_vectors, cluster_components, random_state)
    leaf_50d = reducer_50d.transform(leaf_vectors)
    labels = _cluster(leaf_50d)

    reducer_3d = _fit_umap(leaf_vectors, 3, random_state)
    leaf_3d = reducer_3d.transform(leaf_vectors)

    topic_map = _topics(leaves, labels)
    counts = Counter(labels)
    for label, count in sorted(counts.items()):
        cluster_id = f"hdbscan:global:{label}"
        cluster_label = "Noise" if label == -1 else f"Global cluster {label}"
        _insert_cluster(conn, cluster_id, "global", cluster_label, topic_map.get(label, [f"{count} passages"]))

    for row, point, label in zip(leaves, leaf_3d, labels, strict=True):
        cluster_id = f"hdbscan:global:{label}"
        conn.execute(
            """
            UPDATE semantic_nodes
            SET umap_3d = %s, cluster_id = %s, updated_at = now()
            WHERE id = %s
            """,
            ([float(point[0]), float(point[1]), float(point[2])], cluster_id, row.node_id),
        )
        conn.execute("UPDATE passages SET cluster_id = %s WHERE id = %s", (cluster_id, row.passage_id))

    aggregates = _load_aggregate_rows(conn)
    aggregate_projected = 0
    if aggregates:
        aggregate_vectors = np.array([row.embedding for row in aggregates], dtype=np.float32)
        aggregate_3d = reducer_3d.transform(aggregate_vectors)
        for row, point in zip(aggregates, aggregate_3d, strict=True):
            conn.execute(
                """
                UPDATE semantic_nodes
                SET umap_3d = %s, updated_at = now()
                WHERE id = %s
                """,
                ([float(point[0]), float(point[1]), float(point[2])], row.node_id),
            )
            aggregate_projected += 1

    scoped_clusters = _insert_scoped_clusters(conn, leaves, leaf_50d, "language")
    scoped_clusters += _insert_scoped_clusters(conn, leaves, leaf_50d, "genre")
    aggregate_clusters = 0
    aggregate_clusters += _insert_aggregate_level_clusters(conn, aggregates, "work", random_state)
    aggregate_clusters += _insert_aggregate_level_clusters(conn, aggregates, "author", random_state)

    return {
        "projected": len(leaves) + aggregate_projected,
        "clusters": len(counts) + scoped_clusters + aggregate_clusters,
        "leaf_clusters": len([label for label in counts if label != -1]),
        "aggregate_projected": aggregate_projected,
        "aggregate_clusters": aggregate_clusters,
        "scoped_clusters": scoped_clusters,
    }
