from __future__ import annotations

import re
import csv
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path

from lxml import etree


@dataclass(frozen=True)
class CatalogMetadata:
    collection: str
    author_code: str
    work_code: str
    edition_code: str
    author_id: str
    work_id: str
    edition_id: str
    work_urn: str
    edition_urn: str
    work_title: str | None
    edition_label: str | None
    author_name: str | None
    name_variants: tuple[str, ...]
    wikidata_id: str | None
    genre: str | None
    period: str | None
    date_hint: str | None


GENRE_BY_AUTHOR: dict[str, str] = {
    "aeschylus": "tragedy",
    "aeschines": "rhetoric",
    "andocides": "rhetoric",
    "antiphon": "rhetoric",
    "aristophanes": "comedy",
    "aristotle": "philosophy",
    "athenaeus": "miscellany",
    "catullus": "poetry",
    "caesar": "history",
    "demosthenes": "rhetoric",
    "diogenes laertius": "biography",
    "dinarchus": "rhetoric",
    "epictetus": "philosophy",
    "euripides": "tragedy",
    "herodotus": "history",
    "hesiod": "epic",
    "homer": "epic",
    "hippocrates": "medicine",
    "isocrates": "rhetoric",
    "isaeus": "rhetoric",
    "josephus": "history",
    "lucian": "satire",
    "lycurgus": "rhetoric",
    "new testament": "religion",
    "old testament": "religion",
    "plautus": "comedy",
    "livy": "history",
    "ovid": "poetry",
    "plato": "philosophy",
    "polybius": "history",
    "plutarch": "biography",
    "strabo": "geography",
    "suetonius": "biography",
    "sophocles": "tragedy",
    "thucydides": "history",
    "virgil": "epic",
    "xenophon": "history",
}

PERIOD_BY_AUTHOR: dict[str, str] = {
    "aeschylus": "Classical",
    "aeschines": "Classical",
    "andocides": "Classical",
    "antiphon": "Classical",
    "aristophanes": "Classical",
    "aristotle": "Classical",
    "athenaeus": "Roman",
    "catullus": "Roman",
    "caesar": "Roman",
    "demosthenes": "Classical",
    "diogenes laertius": "Roman",
    "dinarchus": "Classical",
    "epictetus": "Roman",
    "euripides": "Classical",
    "herodotus": "Classical",
    "hesiod": "Archaic",
    "homer": "Archaic",
    "hippocrates": "Classical",
    "isocrates": "Classical",
    "isaeus": "Classical",
    "josephus": "Roman",
    "lucian": "Roman",
    "lycurgus": "Classical",
    "new testament": "Roman",
    "old testament": "Hellenistic",
    "plautus": "Roman",
    "livy": "Roman",
    "ovid": "Roman",
    "plato": "Classical",
    "polybius": "Hellenistic",
    "plutarch": "Roman",
    "strabo": "Roman",
    "suetonius": "Roman",
    "sophocles": "Classical",
    "thucydides": "Classical",
    "virgil": "Roman",
    "xenophon": "Classical",
}


def infer_collection(path: Path) -> str:
    raw = path.as_posix()
    if "latinLit" in raw:
        return "latinLit"
    return "greekLit"


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def parse_codes(path: Path) -> tuple[str, str, str, str]:
    collection = infer_collection(path)
    parts = path.name.removesuffix(".xml").split(".")
    if len(parts) >= 3:
        return collection, parts[0], parts[1], ".".join(parts[2:])
    rel = path.parts
    return collection, rel[-3], rel[-2], path.stem


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.replace("``", "").split())
    if not value or value.casefold() in {"none", "n.a.", "n/a"}:
        return None
    return value


def infer_genre_period(author: str | None, title: str | None) -> tuple[str | None, str | None]:
    haystack = f"{author or ''} {title or ''}".casefold()
    genre = None
    period = None
    for key, value in GENRE_BY_AUTHOR.items():
        if key in haystack:
            genre = value
            break
    for key, value in PERIOD_BY_AUTHOR.items():
        if key in haystack:
            period = value
            break
    if genre is None:
        if re.search(r"\bhistory|war|annals\b", haystack):
            genre = "history"
        elif re.search(r"\btraged|agamemnon|oedipus|medea\b", haystack):
            genre = "tragedy"
        elif re.search(r"\biliad|odyssey|argonaut|aeneid\b", haystack):
            genre = "epic"
        elif re.search(r"\brepublic|ethics|metaphysics|soul|laws\b", haystack):
            genre = "philosophy"
        elif re.search(r"\boration|speech|rhetoric\b", haystack):
            genre = "rhetoric"
    return genre, period


def infer_period_from_date(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"(\d{3,4})\s*BCE?", value, flags=re.IGNORECASE)
    if match:
        year = int(match.group(1))
        if year >= 480:
            return "Archaic"
        if year >= 323:
            return "Classical"
        return "Hellenistic"
    match = re.search(r"\b(\d{1,3})\s*-\s*(\d{1,3})\b", value)
    if match:
        return "Roman"
    return None


def _text(element: etree._Element | None) -> str | None:
    if element is None:
        return None
    value = " ".join(" ".join(element.itertext()).split())
    return value or None


def _read_cts(path: Path, edition_urn: str) -> tuple[str | None, str | None]:
    cts = path.parent / "__cts__.xml"
    if not cts.exists():
        return None, None
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
    root = etree.parse(str(cts), parser).getroot()
    title_nodes = root.xpath("(.//*[local-name()='title'])[1]")
    title = _text(title_nodes[0] if title_nodes else None)
    label = None
    for element in root.xpath(".//*[local-name()='translation' or local-name()='edition']"):
        if element.get("urn") == edition_urn:
            label_nodes = element.xpath("(.//*[local-name()='label'])[1]")
            label = _text(label_nodes[0] if label_nodes else None)
            break
    return title, label


@dataclass(frozen=True)
class AuthorCatalog:
    name: str
    variants: tuple[str, ...]
    wikidata_id: str | None = None


@dataclass(frozen=True)
class WorkCatalog:
    title: str | None
    original_language: str | None
    date_hint: str | None = None


@lru_cache(maxsize=1)
def _author_catalog() -> dict[str, AuthorCatalog]:
    path = project_root() / "data-sources" / "catalog_data" / "citecoll" / "authors.xml"
    if not path.exists():
        return {}
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
    root = etree.parse(str(path), parser).getroot()
    result: dict[str, AuthorCatalog] = {}
    for author in root.xpath(".//*[local-name()='author']"):
        code = _clean(_text(author.find("canonical-id")))
        name = _clean(_text(author.find("authority-name")))
        if not code or not name:
            continue
        variants = [name]
        alt_ids = _clean(_text(author.find("alt-ids")))
        wikidata_id = None
        if alt_ids:
            variants.extend(part.strip() for part in re.split(r"[;|,]", alt_ids) if part.strip())
            match = re.search(r"\bQ\d+\b", alt_ids)
            if match:
                wikidata_id = match.group(0)
        result[code] = AuthorCatalog(name=name, variants=tuple(dict.fromkeys(variants)), wikidata_id=wikidata_id)
    return result


@lru_cache(maxsize=1)
def _work_catalog() -> dict[str, WorkCatalog]:
    result: dict[str, WorkCatalog] = {}
    works_path = project_root() / "data-sources" / "catalog_data" / "citecoll" / "works.xml"
    if works_path.exists():
        parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
        root = etree.parse(str(works_path), parser).getroot()
        for work in root.xpath(".//*[local-name()='work' and ./*[local-name()='work']]"):
            urn = _clean(_text(work.find("work")))
            if not urn:
                continue
            code = urn.rsplit(":", 1)[-1]
            result[code] = WorkCatalog(
                title=_clean(_text(work.find("title-eng"))),
                original_language=_clean(_text(work.find("orig-lang"))),
            )
    id_matches = project_root() / "data-sources" / "catalog_data" / "citecoll" / "IDMatches.csv"
    if id_matches.exists():
        with id_matches.open(newline="", encoding="utf-8", errors="ignore") as handle:
            reader = csv.reader(handle, delimiter="\t")
            for row in reader:
                if len(row) < 19:
                    continue
                author_name = _clean(row[0])
                title = _clean(row[5])
                tlg = _clean(row[17])
                date_hint = _clean(row[18])
                if not author_name or not title or not tlg or "." not in tlg:
                    continue
                author_code, work_code = tlg.split(".", 1)
                key = f"tlg{author_code}.tlg{work_code}"
                existing = result.get(key)
                result[key] = WorkCatalog(
                    title=existing.title if existing and existing.title else title,
                    original_language=existing.original_language if existing else "grc",
                    date_hint=date_hint,
                )
    return result


def metadata_for_path(path: Path, author: str | None, title: str | None) -> CatalogMetadata:
    collection, author_code, work_code, edition_code = parse_codes(path)
    work_urn = f"urn:cts:{collection}:{author_code}.{work_code}"
    edition_urn = f"{work_urn}.{edition_code}"
    cts_title, cts_label = _read_cts(path, edition_urn)
    author_record = _author_catalog().get(author_code)
    work_record = _work_catalog().get(f"{author_code}.{work_code}")
    author_name = author_record.name if author_record else author
    work_title = work_record.title if work_record and work_record.title else cts_label or cts_title or title
    genre, inferred_period = infer_genre_period(author_name or author, work_title)
    period = infer_period_from_date(work_record.date_hint if work_record else None) or inferred_period
    return CatalogMetadata(
        collection=collection,
        author_code=author_code,
        work_code=work_code,
        edition_code=edition_code,
        author_id=f"author:{collection}:{author_code}",
        work_id=f"work:{collection}:{author_code}.{work_code}",
        edition_id=f"edition:{collection}:{author_code}.{work_code}.{edition_code}",
        work_urn=work_urn,
        edition_urn=edition_urn,
        work_title=work_title,
        edition_label=cts_label,
        author_name=author_name,
        name_variants=author_record.variants if author_record else tuple([author] if author else []),
        wikidata_id=author_record.wikidata_id if author_record else None,
        genre=genre,
        period=period,
        date_hint=work_record.date_hint if work_record else None,
    )
