from __future__ import annotations

from perseus_pipeline.vector import token_weighted_mean


def aggregate_embeddings(children: list[tuple[list[float], int]]) -> list[float]:
    vectors = [vector for vector, _ in children]
    token_counts = [count for _, count in children]
    return token_weighted_mean(vectors, token_counts)

