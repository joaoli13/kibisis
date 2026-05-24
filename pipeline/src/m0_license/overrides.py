from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

import yaml


@dataclass(frozen=True)
class LicenseOverride:
    pattern: str
    decision: str
    reason: str
    declared_license: str | None = None


def load_overrides(path: Path) -> list[LicenseOverride]:
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text()) or {}
    return [LicenseOverride(**item) for item in raw.get("overrides", [])]


def match_override(path: Path, overrides: list[LicenseOverride]) -> LicenseOverride | None:
    normalized = path.as_posix()
    for override in overrides:
        if fnmatch(normalized, override.pattern):
            return override
    return None

