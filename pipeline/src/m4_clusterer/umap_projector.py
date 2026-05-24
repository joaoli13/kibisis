from __future__ import annotations

import numpy as np
import umap


def project_embeddings(embeddings: list[list[float]], random_state: int = 42) -> list[list[float]]:
    if not embeddings:
        return []
    n_neighbors = min(15, max(2, len(embeddings) - 1))
    reducer = umap.UMAP(n_components=3, n_neighbors=n_neighbors, random_state=random_state)
    projection = reducer.fit_transform(np.array(embeddings, dtype=float))
    return projection.astype(float).tolist()

