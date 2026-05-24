from __future__ import annotations

from typing import Any


EMBEDDING_INPUT_VERSION = "m3-context-v1"


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def _metadata_line(label: str, value: object) -> str | None:
    cleaned = _clean(value)
    return f"{label}: {cleaned}" if cleaned else None


def _hierarchy_label(item: Any) -> str | None:
    if not isinstance(item, dict):
        return None
    level = _clean(item.get("level"))
    ref = _clean(item.get("ref"))
    title = _clean(item.get("title"))
    if not level and not ref and not title:
        return None
    identifier = " ".join(part for part in (level, ref) if part)
    if title and identifier:
        return f"{identifier} - {title}"
    return title or identifier


def build_embedding_text(row: dict[str, Any]) -> str:
    """Build the exact text sent to the embedding model for one passage node."""
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    hierarchy = metadata.get("hierarchy") if isinstance(metadata, dict) else None
    hierarchy_parts = [_hierarchy_label(item) for item in hierarchy] if isinstance(hierarchy, list) else []
    hierarchy_text = " > ".join(part for part in hierarchy_parts if part)

    lines = [
        f"Embedding input version: {EMBEDDING_INPUT_VERSION}",
        _metadata_line("Author", row.get("author")),
        _metadata_line("Work", row.get("work")),
        _metadata_line("Genre", row.get("genre")),
        _metadata_line("Period", row.get("period")),
        _metadata_line("Language", row.get("language")),
        _metadata_line("Text type", row.get("text_type")),
        _metadata_line("Passage", row.get("passage_ref")),
        _metadata_line("Hierarchy", hierarchy_text),
        "",
        "Text:",
        _clean(row.get("text")) or "",
    ]
    return "\n".join(line for line in lines if line is not None)
