from __future__ import annotations

from collections import Counter, defaultdict

import hdbscan
import numpy as np


def cluster_embeddings(embeddings: list[list[float]], min_cluster_size: int = 5) -> list[int]:
    if not embeddings:
        return []
    if len(embeddings) < min_cluster_size:
        return [0 for _ in embeddings]
    model = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size)
    return [int(label) for label in model.fit_predict(np.array(embeddings, dtype=float))]


def top_terms_by_cluster(texts: list[str], labels: list[int], top_n: int = 8) -> dict[int, list[str]]:
    grouped: dict[int, Counter[str]] = defaultdict(Counter)
    for text, label in zip(texts, labels, strict=True):
        for token in text.lower().split():
            if len(token) > 3:
                grouped[label][token.strip(".,;:!?()[]")] += 1
    return {label: [term for term, _ in counts.most_common(top_n)] for label, counts in grouped.items()}

