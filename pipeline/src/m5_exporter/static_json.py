from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any


def write_json_gz(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    with gzip.open(f"{path}.gz", "wt", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)


def export_static_json(output_dir: Path, passages: list[dict[str, Any]], nodes: list[dict[str, Any]], clusters: list[dict[str, Any]], authors: list[dict[str, Any]], dataset_snapshot: str | None) -> None:
    for passage in passages:
        if passage.get("license_status") != "cc_compatible":
            raise RuntimeError(f"Refusing to export non-CC passage {passage.get('id')}")
    write_json_gz(output_dir / "passages.json", passages)
    write_json_gz(output_dir / "nodes.json", nodes)
    write_json_gz(output_dir / "clusters.json", clusters)
    write_json_gz(output_dir / "authors.json", authors)
    write_json_gz(output_dir / "metadata.json", {"dataset_snapshot": dataset_snapshot})

