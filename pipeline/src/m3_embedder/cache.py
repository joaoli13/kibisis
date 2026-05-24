from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def cache_path(cache_dir: Path, text: str) -> Path:
    return cache_dir / f"{text_hash(text)}.parquet"


def read_cached_embedding(cache_dir: Path, text: str) -> list[float] | None:
    path = cache_path(cache_dir, text)
    if not path.exists():
        return None
    frame = pd.read_parquet(path)
    return [float(value) for value in frame["value"].tolist()]


def write_cached_embedding(cache_dir: Path, text: str, embedding: list[float]) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path(cache_dir, text)
    pd.DataFrame({"value": embedding}).to_parquet(path, index=False)
    return path

