from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from lxml import etree

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


@dataclass(frozen=True)
class CanonicalAncestor:
    level: str
    ref: str
    cts_urn: str
    title: str | None = None


@dataclass(frozen=True)
class ParsedPassage:
    cts_urn: str
    passage_ref: str
    text: str
    language: str | None
    author: str | None
    work: str | None
    edition: str | None
    translator: str | None
    edition_year: int | None
    hierarchy: tuple[CanonicalAncestor, ...] = ()
    paragraphs: tuple[str, ...] = ()
    speaker: str | None = None


def _first(root: etree._Element, local_name: str) -> str | None:
    nodes = root.xpath(f".//*[local-name()='{local_name}']")
    for node in nodes:
        text = " ".join(" ".join(node.itertext()).split())
        if text:
            return text
    return None


def _metadata(root: etree._Element) -> dict[str, str | int | None]:
    title = _first(root, "title")
    author = _first(root, "author")
    edition = _first(root, "edition")
    lang_nodes = root.xpath(".//*[local-name()='language']")
    lang = lang_nodes[0].get("ident") if len(lang_nodes) == 1 else None
    year = None
    date_text = _first(root, "date") or ""
    match = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", date_text)
    if match:
        year = int(match.group(1))
    translator = None
    editor_translator = root.xpath(".//*[local-name()='editor' and @role='translator']")
    if editor_translator:
        translator = " ".join(" ".join(editor_translator[0].itertext()).split()) or None
    for resp_stmt in root.xpath(".//*[local-name()='respStmt']"):
        text = " ".join(resp_stmt.itertext())
        if "translator" in text.lower() or "translated" in text.lower():
            names = [
                " ".join(name.itertext()).strip()
                for name in resp_stmt.xpath(".//*[local-name()='name']")
            ]
            translator = names[0] if names else None
    return {
        "author": author,
        "work": title,
        "edition": edition,
        "language": lang,
        "translator": translator,
        "edition_year": year,
    }


def _ref(element: etree._Element, fallback: int) -> str:
    return (
        element.get("n")
        or element.get("{http://www.w3.org/XML/1998/namespace}id")
        or element.get("id")
        or str(fallback)
    )


def _local(element: etree._Element) -> str:
    if not isinstance(element.tag, str):
        return ""
    return etree.QName(element).localname


def _clean_text(element: etree._Element) -> str:
    return " ".join(" ".join(element.itertext()).split())


def _direct_child_text(element: etree._Element, local_name: str) -> list[str]:
    values = []
    for child in element:
        if _local(child) == local_name:
            text = _clean_text(child)
            if text:
                values.append(text)
    return values


def _base_urn_from_path(path: Path) -> str:
    stem = path.name.removesuffix(".xml")
    collection = "latinLit" if "latinLit" in path.as_posix() else "greekLit"
    return f"urn:cts:{collection}:{stem}"


def _language_from_identifier(value: str | None) -> str | None:
    if not value:
        return None
    matches = re.findall(r"[.-]([a-z]{3})(?:\d+)?(?::|\.xml$|$)", value)
    return matches[-1] if matches else None


def _xml_lang(element: etree._Element) -> str | None:
    return element.get(XML_LANG) or element.get("lang")


LEVEL_ALIASES = {
    "book": "book",
    "chapter": "chapter",
    "section": "section",
    "card": "section",
    "episode": "chapter",
    "dialogue": "section",
    "lyric": "section",
    "epigram": "section",
    "poem": "section",
}


def _part_level(element: etree._Element) -> str | None:
    subtype = (element.get("subtype") or "").casefold()
    type_value = (element.get("type") or "").casefold()
    return LEVEL_ALIASES.get(subtype) or LEVEL_ALIASES.get(type_value)


def _part_ref(parts: list[CanonicalAncestor], element: etree._Element, fallback: int) -> str:
    own = _ref(element, fallback)
    if own.startswith("urn:cts:"):
        return own.rsplit(":", 1)[-1]
    parent_ref = parts[-1].ref if parts else ""
    if _local(element) in {"p", "ab"} and parent_ref:
        return parent_ref
    if _local(element) == "sp":
        line_refs = [
            child.get("n")
            for child in element.xpath(".//*[local-name()='l']")
            if child.get("n")
        ]
        if line_refs:
            return line_refs[0] if len(line_refs) == 1 else f"{line_refs[0]}-{line_refs[-1]}"
    if parent_ref and own != parent_ref:
        return f"{parent_ref}.{own}"
    return own


def _ancestor_urn(base_urn: str, ref: str) -> str:
    return ref if ref.startswith("urn:cts:") else f"{base_urn}:{ref}"


def _part_title(element: etree._Element) -> str | None:
    for name in ("head", "label", "title"):
        values = _direct_child_text(element, name)
        if values:
            return values[0]
    return None


def _is_candidate(element: etree._Element) -> bool:
    local = _local(element)
    if not _clean_text(element):
        return False
    if local == "sp":
        return True
    if local in {"p", "l", "ab"}:
        has_speech_ancestor = bool(element.xpath("ancestor::*[local-name()='sp']"))
        return not has_speech_ancestor
    if local == "div":
        descendant_text_blocks = element.xpath(
            ".//*[local-name()='sp' or local-name()='p' or local-name()='l' or local-name()='ab']"
        )
        return len(descendant_text_blocks) == 0
    return False


def _base_urn(root: etree._Element, path: Path) -> str:
    for element in root.xpath(".//*[@n]"):
        value = element.get("n") or ""
        if value.startswith("urn:cts:"):
            return value
    stem = path.name.removesuffix(".xml")
    collection = "latinLit" if "latinLit" in path.as_posix() else "greekLit"
    return f"urn:cts:{collection}:{stem}"


def _parse_with_iterparse(path: Path) -> list[ParsedPassage]:
    metadata: dict[str, str | int | None] = {
        "author": None,
        "work": None,
        "edition": None,
        "language": None,
        "translator": None,
        "edition_year": None,
    }
    base_urn = _base_urn_from_path(path)
    text_language = _language_from_identifier(base_urn)
    passages: list[ParsedPassage] = []
    in_body = False
    sp_depth = 0
    note_depth = 0
    div_stack: list[CanonicalAncestor] = []
    div_push_stack: list[bool] = []
    fallback = 0

    context = etree.iterparse(
        str(path),
        events=("start", "end"),
        recover=True,
        huge_tree=True,
        resolve_entities=False,
        no_network=True,
    )
    for event, element in context:
        local = _local(element)
        if event == "start":
            if local == "body":
                in_body = True
            elif in_body and local == "note":
                note_depth += 1
            elif in_body and local == "sp":
                sp_depth += 1
            elif in_body and local == "div":
                level = _part_level(element)
                raw_ref = element.get("n") or ""
                if raw_ref.startswith("urn:cts:"):
                    base_urn = raw_ref
                    text_language = _xml_lang(element) or _language_from_identifier(base_urn) or text_language
                pushed = False
                if level and raw_ref and not raw_ref.startswith("urn:cts:"):
                    parent_ref = div_stack[-1].ref if div_stack else ""
                    ref = raw_ref if not parent_ref else f"{parent_ref}.{raw_ref}"
                    div_stack.append(CanonicalAncestor(level, ref, _ancestor_urn(base_urn, ref), _part_title(element)))
                    pushed = True
                div_push_stack.append(pushed)
            continue

        if local == "teiHeader":
            metadata = _metadata(element)
            element.clear()
            continue

        if not in_body:
            continue

        if note_depth:
            if local == "note":
                note_depth = max(0, note_depth - 1)
                element.clear()
            continue

        if sp_depth and local in {"speaker", "l", "p", "ab"}:
            continue

        if local in {"p", "l", "ab", "sp"}:
            if not _is_candidate(element):
                continue
            fallback += 1
            ref = _part_ref(div_stack, element, fallback)
            text = _clean_text(element)
            paragraphs = tuple(_direct_child_text(element, "p")) if local == "sp" else (text,)
            speaker = None
            if local == "sp":
                speakers = _direct_child_text(element, "speaker")
                speaker = speakers[0] if speakers else None
            passages.append(
                ParsedPassage(
                    cts_urn=_ancestor_urn(base_urn, ref),
                    passage_ref=ref,
                    text=text,
                    language=text_language or (metadata["language"] if isinstance(metadata["language"], str) else None),
                    author=metadata["author"] if isinstance(metadata["author"], str) else None,
                    work=metadata["work"] if isinstance(metadata["work"], str) else None,
                    edition=metadata["edition"] if isinstance(metadata["edition"], str) else None,
                    translator=metadata["translator"] if isinstance(metadata["translator"], str) else None,
                    edition_year=metadata["edition_year"] if isinstance(metadata["edition_year"], int) else None,
                    hierarchy=tuple(div_stack),
                    paragraphs=paragraphs,
                    speaker=speaker,
                )
            )

        if local == "sp":
            sp_depth = max(0, sp_depth - 1)
        elif local == "div":
            pushed = div_push_stack.pop() if div_push_stack else False
            if pushed and div_stack:
                div_stack.pop()
        elif local == "body":
            in_body = False
        element.clear()
    return passages


def parse_tei(path: Path) -> list[ParsedPassage]:
    return _parse_with_iterparse(path)
