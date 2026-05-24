from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_SOURCES = REPO_ROOT / "data-sources"


def resolve_source_repo(kind: str) -> Path:
    aliases = {
        "greek": ["canonical-greekLit", "greekLit_data"],
        "latin": ["canonical-latinLit", "latinLit_data"],
        "catalog": ["catalog", "catalog_data"],
    }
    for name in aliases[kind]:
        path = DATA_SOURCES / name
        if path.exists():
            return path
    return DATA_SOURCES / aliases[kind][0]


def iter_corpus_xml() -> list[Path]:
    paths: list[Path] = []
    for kind in ("greek", "latin"):
        data_dir = resolve_source_repo(kind) / "data"
        if data_dir.exists():
            paths.extend(sorted(data_dir.rglob("*.xml")))
    return paths


def iter_translation_xml(language: str = "eng") -> list[Path]:
    suffix = f"-{language}"
    return [
        path
        for path in iter_corpus_xml()
        if suffix in path.name and not path.name.startswith("__cts__")
    ]
