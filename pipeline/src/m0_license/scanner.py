from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from lxml import etree

from .overrides import LicenseOverride, match_override
from .repo_resolver import resolve_repo_license


CC_INCOMPATIBLE = re.compile(
    r"creativecommons\.org/licenses/by-(?:nc|nd|nc-sa|nc-nd)/|"
    r"\bcc\s*by\s*-\s*(?:nc|nd|nc-sa|nc-nd)\b|"
    r"non[-\s]?commercial|no derivatives",
    re.I,
)
CC_COMPATIBLE = re.compile(
    r"creativecommons\.org/licenses/by(?:-sa)?/[0-9.]+|"
    r"\bcc\s*by(?:\s*-\s*sa)?(?:\s+[0-9.]+|\b)|"
    r"creative commons attribution(?:[-\s]sharealike)?",
    re.I,
)
RESTRICTED = re.compile(
    r"all rights reserved|used by permission|permission (?:is )?required|"
    r"with permission|not for distribution|may not be reproduced",
    re.I,
)


@dataclass(frozen=True)
class LicenseDecision:
    file_path: str
    declared_license: str | None
    decision: str
    decision_reason: str
    license_source: str
    edition_year: int | None = None
    translator: str | None = None
    is_public_domain_original: bool = False


def classify_license(text: str | None) -> tuple[str, str]:
    if not text:
        return "unknown", "no license text found"
    if CC_INCOMPATIBLE.search(text):
        return "restricted", "license text contains CC-incompatible terms"
    if CC_COMPATIBLE.search(text):
        return "cc_compatible", "license text contains CC BY-compatible terms"
    if RESTRICTED.search(text):
        return "restricted", "license text contains restrictive terms"
    return "unknown", "license text did not match known compatible or restricted patterns"


def _text_nodes(root: etree._Element, local_names: tuple[str, ...]) -> str | None:
    values: list[str] = []
    for name in local_names:
        for element in root.xpath(f".//*[local-name()='{name}']"):
            text = " ".join(" ".join(element.itertext()).split())
            if text:
                values.append(text)
    return "\n".join(values) or None


def extract_header_license(path: Path) -> str | None:
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
    root = etree.parse(str(path), parser).getroot()
    return _text_nodes(root, ("licence", "license", "availability"))


def extract_edition_metadata(path: Path) -> tuple[int | None, str | None, bool]:
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
    root = etree.parse(str(path), parser).getroot()
    header_text = _text_nodes(root, ("edition", "date")) or ""
    year_match = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", header_text)
    year = int(year_match.group(1)) if year_match else None
    translator = None
    for resp_stmt in root.xpath(".//*[local-name()='respStmt']"):
        text = " ".join(resp_stmt.itertext())
        if "translator" in text.lower() or "translated" in text.lower():
            names = [
                " ".join(name.itertext()).strip()
                for name in resp_stmt.xpath(".//*[local-name()='name']")
            ]
            translator = names[0] if names else None
            break
    return year, translator, bool(year and year < 1929)


def scan_file(path: Path, repo_root: Path, overrides: list[LicenseOverride] | None = None) -> LicenseDecision:
    override = match_override(path, overrides or [])
    year, translator, public_domain = extract_edition_metadata(path)
    if override is not None:
        return LicenseDecision(
            file_path=str(path),
            declared_license=override.declared_license,
            decision=override.decision,
            decision_reason=override.reason,
            license_source="overrides",
            edition_year=year,
            translator=translator,
            is_public_domain_original=public_domain,
        )

    declared = extract_header_license(path)
    decision, reason = classify_license(declared)
    if decision != "unknown":
        source = "tei_header"
    else:
        repo_license = resolve_repo_license(repo_root)
        if repo_license is not None:
            declared = repo_license.text
            decision, reason = classify_license(repo_license.text)
            source = repo_license.source
        else:
            source = "default"

    return LicenseDecision(
        file_path=str(path),
        declared_license=declared,
        decision=decision,
        decision_reason=reason,
        license_source=source,
        edition_year=year,
        translator=translator,
        is_public_domain_original=public_domain,
    )
