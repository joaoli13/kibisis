from __future__ import annotations

from pathlib import Path

import pytest

from m3_embedder.aggregator import aggregate_embeddings
from m3_embedder.cache import read_cached_embedding, write_cached_embedding
from m5_exporter.static_json import export_static_json


def test_weighted_average_is_l2_normalized() -> None:
    result = aggregate_embeddings([([1.0, 0.0], 3), ([0.0, 1.0], 4)])
    norm = sum(value * value for value in result) ** 0.5
    assert norm == pytest.approx(1.0)
    assert result[1] > result[0]


def test_cache_roundtrip(tmp_path: Path) -> None:
    write_cached_embedding(tmp_path, "abc", [0.1, 0.2])
    assert read_cached_embedding(tmp_path, "abc") == [0.1, 0.2]


def test_static_export_blocks_non_cc(tmp_path: Path) -> None:
    try:
        export_static_json(
            tmp_path,
            [{"id": "p1", "license_status": "restricted"}],
            [],
            [],
            [],
            None,
        )
    except RuntimeError as exc:
        assert "non-CC" in str(exc)
    else:
        raise AssertionError("expected non-CC export to fail")
