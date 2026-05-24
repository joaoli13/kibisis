from __future__ import annotations

import os

os.environ.setdefault("NUMBA_DISABLE_JIT", "1")

import numpy as np

from m4_clusterer import db_projector
from m4_clusterer.db_projector import AggregateRow


class FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.calls.append((query, params))


class FakeReducer:
    def transform(self, vectors: np.ndarray) -> np.ndarray:
        return vectors[:, :2]


class FakeProjectResult:
    def __init__(self, rows: list[tuple[object, ...]]) -> None:
        self.rows = rows

    def fetchall(self) -> list[tuple[object, ...]]:
        return self.rows


class FakeProjectConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.leaves = [
            ("leaf:odyssey:1", "passage:odyssey:1", "eng", "epic", "Odysseus receives welcome", "[1.0,1.0,1.0]"),
            ("leaf:odyssey:2", "passage:odyssey:2", "eng", "epic", "Guests and hosts share gifts", "[1.2,1.0,1.0]"),
            ("leaf:odyssey:3", "passage:odyssey:3", "eng", "epic", "The stranger is sheltered", "[0.8,1.0,1.0]"),
            ("leaf:other:1", "passage:other:1", "eng", "history", "A battle narrative", "[-1.0,-1.0,-1.0]"),
        ]
        self.aggregates = [
            ("node:work:odyssey", "work", "[1.0,1.0,1.0]"),
        ]

    def execute(self, query: str, params: tuple[object, ...] = ()) -> FakeProjectResult:
        self.calls.append((query, params))
        if "JOIN passages p ON p.id = n.passage_id" in query:
            return FakeProjectResult(self.leaves)
        if "WHERE level IN ('section', 'chapter', 'book', 'work', 'author')" in query:
            return FakeProjectResult(self.aggregates)
        return FakeProjectResult([])


class IdentityReducer:
    def __init__(self, n_components: int, random_state: int) -> None:
        self.n_components = n_components
        self.random_state = random_state

    def transform(self, vectors: np.ndarray) -> np.ndarray:
        if vectors.shape[1] >= self.n_components:
            return vectors[:, : self.n_components]
        padding = np.zeros((vectors.shape[0], self.n_components - vectors.shape[1]), dtype=vectors.dtype)
        return np.concatenate([vectors, padding], axis=1)


def fake_fit_umap(_vectors: np.ndarray, n_components: int, random_state: int) -> IdentityReducer:
    return IdentityReducer(n_components, random_state)


def fake_cluster(vectors: np.ndarray) -> list[int]:
    return [0 for _ in range(len(vectors))]


def test_aggregate_level_clusters_are_unlabeled(monkeypatch) -> None:
    conn = FakeConn()
    rows = [
        AggregateRow(f"node:work:{index}", "work", [float(index), float(index + 1), 0.0])
        for index in range(3)
    ]

    monkeypatch.setattr(db_projector, "_fit_umap", lambda *_args: FakeReducer())
    monkeypatch.setattr(db_projector, "_cluster", lambda _vectors: [0, 0, -1])

    inserted = db_projector._insert_aggregate_level_clusters(conn, rows, "work", 42)

    assert inserted == 2
    cluster_calls = [params for query, params in conn.calls if "INSERT INTO clusters" in query]
    assert cluster_calls == [
        ("hdbscan:work:-1", "work", None, []),
        ("hdbscan:work:0", "work", None, []),
    ]
    update_calls = [params for query, params in conn.calls if "UPDATE semantic_nodes" in query]
    assert update_calls == [
        ("hdbscan:work:0", "node:work:0"),
        ("hdbscan:work:0", "node:work:1"),
        ("hdbscan:work:-1", "node:work:2"),
    ]


def test_m4_projection_is_deterministic_with_fixed_seed(monkeypatch) -> None:
    monkeypatch.setattr(db_projector, "_fit_umap", fake_fit_umap)
    monkeypatch.setattr(db_projector, "_cluster", fake_cluster)

    first = FakeProjectConn()
    second = FakeProjectConn()

    first_result = db_projector.project_embedded_nodes(first, random_state=42)
    second_result = db_projector.project_embedded_nodes(second, random_state=42)

    assert first_result == second_result
    assert first.calls == second.calls


def test_work_projection_stays_near_leaf_centroid(monkeypatch) -> None:
    monkeypatch.setattr(db_projector, "_fit_umap", fake_fit_umap)
    monkeypatch.setattr(db_projector, "_cluster", fake_cluster)

    conn = FakeProjectConn()
    db_projector.project_embedded_nodes(conn, random_state=42)

    node_points = {}
    for query, params in conn.calls:
        if "UPDATE semantic_nodes" not in query or "SET umap_3d" not in query:
            continue
        node_id = params[2] if len(params) == 3 else params[1]
        node_points[str(node_id)] = np.array(params[0], dtype=float)
    odyssey_leaf_points = [
        point
        for node_id, point in node_points.items()
        if str(node_id).startswith("leaf:odyssey:")
    ]
    odyssey_centroid = np.mean(odyssey_leaf_points, axis=0)

    assert np.linalg.norm(node_points["node:work:odyssey"] - odyssey_centroid) < 0.01
