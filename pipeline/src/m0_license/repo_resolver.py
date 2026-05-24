from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RepoLicense:
    text: str
    source: str


def resolve_repo_license(repo_root: Path) -> RepoLicense | None:
    for name in ("LICENSE.md", "LICENSE", "LICENCE"):
        path = repo_root / name
        if path.exists():
            return RepoLicense(path.read_text(errors="ignore"), "repo_license_file")
    readme = repo_root / "README.md"
    if readme.exists():
        text = readme.read_text(errors="ignore")
        lines = [line for line in text.splitlines() if "licen" in line.lower() or "cc by" in line.lower()]
        if lines:
            return RepoLicense("\n".join(lines), "repo_readme")
    return None

