from __future__ import annotations

import math


def l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return values
    return [value / norm for value in values]


def token_weighted_mean(vectors: list[list[float]], token_counts: list[int]) -> list[float]:
    if not vectors:
        return []
    width = len(vectors[0])
    totals = [0.0] * width
    weight_sum = sum(max(count, 0) for count in token_counts)
    if weight_sum == 0:
        weight_sum = len(vectors)
        token_counts = [1] * len(vectors)
    for vector, weight in zip(vectors, token_counts, strict=True):
        for index, value in enumerate(vector):
            totals[index] += value * weight
    return l2_normalize([value / weight_sum for value in totals])

