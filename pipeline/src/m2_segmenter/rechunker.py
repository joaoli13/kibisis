from __future__ import annotations

import re
from dataclasses import dataclass
from string import ascii_lowercase

from .tokenizer import estimate_token_count


@dataclass(frozen=True)
class Chunk:
    passage_ref: str
    text: str
    token_count: int
    passage_ref_synthetic: bool = False


def _sentence_split(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?;:])\s+", text)
    return [part.strip() for part in parts if part.strip()]


def _window_words(words: list[str], budget_words: int) -> list[str]:
    stride = max(1, int(budget_words * 0.85))
    return [" ".join(words[index : index + budget_words]) for index in range(0, len(words), stride)]


def _suffix(index: int) -> str:
    if index < len(ascii_lowercase):
        return ascii_lowercase[index]
    return f"x{index + 1}"


def _pack_units(units: list[str], passage_ref: str, language: str | None, token_budget: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    current: list[str] = []
    for unit in units:
        candidate = "\n".join([*current, unit])
        if current and estimate_token_count(candidate, language) > token_budget:
            text = "\n".join(current)
            chunks.append(Chunk(f"{passage_ref}{_suffix(len(chunks))}", text, estimate_token_count(text, language)))
            current = [unit]
        else:
            current.append(unit)
    if current:
        text = "\n".join(current)
        chunks.append(Chunk(f"{passage_ref}{_suffix(len(chunks))}", text, estimate_token_count(text, language)))
    return chunks


def chunk_text(
    text: str,
    passage_ref: str,
    language: str | None = None,
    token_budget: int = 1800,
    floor_words: int = 700,
    paragraphs: tuple[str, ...] | list[str] | None = None,
) -> list[Chunk]:
    if estimate_token_count(text, language) <= token_budget:
        return [Chunk(passage_ref, text, estimate_token_count(text, language))]

    paragraph_units = [part.strip() for part in (paragraphs or re.split(r"\n\s*\n", text)) if part.strip()]
    if len(paragraph_units) > 1 and all(estimate_token_count(part, language) <= token_budget for part in paragraph_units):
        return _pack_units(paragraph_units, passage_ref, language, token_budget)

    sentences = _sentence_split(text)
    if len(sentences) > 1 and all(estimate_token_count(part, language) <= token_budget for part in sentences):
        return _pack_units(sentences, passage_ref, language, token_budget)

    words = text.split()
    budget_words = max(1, int(token_budget / (1.6 if language in {"grc", "lat"} else 1.3)))
    return [
        Chunk(f"{passage_ref}{_suffix(index)}", part, estimate_token_count(part, language), True)
        for index, part in enumerate(_window_words(words, budget_words))
    ]


def group_short_chunks(chunks: list[Chunk], floor_words: int = 700) -> list[Chunk]:
    grouped: list[Chunk] = []
    current: list[Chunk] = []
    for chunk in chunks:
        current.append(chunk)
        if sum(len(item.text.split()) for item in current) >= floor_words:
            grouped.append(_merge(current))
            current = []
    if current:
        grouped.append(_merge(current))
    return grouped


def _merge(chunks: list[Chunk]) -> Chunk:
    if len(chunks) == 1:
        return chunks[0]
    ref = f"{chunks[0].passage_ref}-{chunks[-1].passage_ref}"
    text = "\n".join(chunk.text for chunk in chunks)
    return Chunk(ref, text, sum(chunk.token_count for chunk in chunks), any(c.passage_ref_synthetic for c in chunks))
