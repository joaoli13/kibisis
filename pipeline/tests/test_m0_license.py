from __future__ import annotations

from pathlib import Path

from m0_license.overrides import LicenseOverride
from m0_license.scanner import scan_file


def write_tei(path: Path, availability: str = "") -> None:
    path.write_text(
        f"""
        <TEI>
          <teiHeader>
            <fileDesc>
              <titleStmt><title>Odyssey</title></titleStmt>
              <publicationStmt><availability>{availability}</availability></publicationStmt>
              <sourceDesc>
                <bibl><edition>Translated by Test Translator, 1919</edition></bibl>
              </sourceDesc>
            </fileDesc>
          </teiHeader>
          <text><body><div n="1"><p>Sing to me of the man.</p></div></body></text>
        </TEI>
        """,
        encoding="utf-8",
    )


def test_header_explicit_cc(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    file_path = repo / "text.xml"
    write_tei(file_path, "Creative Commons Attribution-ShareAlike 4.0")
    decision = scan_file(file_path, repo)
    assert decision.decision == "cc_compatible"
    assert decision.license_source == "tei_header"
    assert decision.edition_year == 1919


def test_repo_license_fallback(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "LICENSE.md").write_text("CC BY-SA 4.0", encoding="utf-8")
    file_path = repo / "text.xml"
    write_tei(file_path)
    decision = scan_file(file_path, repo)
    assert decision.decision == "cc_compatible"
    assert decision.license_source == "repo_license_file"


def test_repo_license_fallback_accepts_cc_legal_text(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "LICENSE.md").write_text(
        """
        Creative Commons Attribution-ShareAlike 4.0 International Public License.
        The licensor grants permission under this license. No additional
        restrictions may be applied.
        """,
        encoding="utf-8",
    )
    file_path = repo / "text.xml"
    write_tei(file_path)
    decision = scan_file(file_path, repo)
    assert decision.decision == "cc_compatible"
    assert decision.license_source == "repo_license_file"


def test_cc_noncommercial_is_restricted(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    file_path = repo / "text.xml"
    write_tei(file_path, "CC BY-NC-SA 4.0")
    decision = scan_file(file_path, repo)
    assert decision.decision == "restricted"
    assert decision.license_source == "tei_header"


def test_repo_readme_fallback(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "README.md").write_text("License: CC BY-SA 4.0", encoding="utf-8")
    file_path = repo / "text.xml"
    write_tei(file_path)
    decision = scan_file(file_path, repo)
    assert decision.decision == "cc_compatible"
    assert decision.license_source == "repo_readme"


def test_override_has_precedence(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    file_path = repo / "text.xml"
    write_tei(file_path, "All rights reserved")
    decision = scan_file(
        file_path,
        repo,
        [LicenseOverride(pattern="*/text.xml", decision="cc_compatible", reason="manual review")],
    )
    assert decision.decision == "cc_compatible"
    assert decision.license_source == "overrides"


def test_default_unknown(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    file_path = repo / "text.xml"
    write_tei(file_path)
    decision = scan_file(file_path, repo)
    assert decision.decision == "unknown"
    assert decision.license_source == "default"
