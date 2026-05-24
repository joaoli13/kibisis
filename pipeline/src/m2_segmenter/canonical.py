from __future__ import annotations

from dataclasses import dataclass

from m1_ingestor import ParsedPassage


@dataclass(frozen=True)
class CanonicalUnit:
    passage_ref: str
    cts_urn: str
    level: str


def identify_canonical_unit(passage: ParsedPassage) -> CanonicalUnit:
    if passage.hierarchy:
        deepest = passage.hierarchy[-1]
        return CanonicalUnit(
            passage_ref=passage.passage_ref,
            cts_urn=passage.cts_urn,
            level=deepest.level,
        )
    if passage.speaker:
        return CanonicalUnit(passage.passage_ref, passage.cts_urn, "speech")
    return CanonicalUnit(passage.passage_ref, passage.cts_urn, "passage")
