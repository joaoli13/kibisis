from __future__ import annotations

from pathlib import Path

from m1_ingestor import CanonicalAncestor, parse_tei
from m1_ingestor.catalog import metadata_for_path
from m3_embedder.embedding_text import EMBEDDING_INPUT_VERSION, build_embedding_text
from m2_segmenter.canonical import identify_canonical_unit
from m2_segmenter.hierarchy import SemanticNode, build_basic_hierarchy, build_canonical_hierarchy
from m2_segmenter.rechunker import chunk_text, group_short_chunks


def test_parse_tei_drama_speech(tmp_path: Path) -> None:
    path = tmp_path / "drama.xml"
    path.write_text(
        """
        <TEI xml:lang="eng">
          <teiHeader><fileDesc><titleStmt><title>Play</title><author>Aeschylus</author></titleStmt></fileDesc></teiHeader>
          <text><body><div n="1"><sp n="1"><speaker>A</speaker><p>Words in a speech.</p></sp></div></body></text>
        </TEI>
        """,
        encoding="utf-8",
    )
    passages = parse_tei(path)
    assert passages
    assert passages[0].author == "Aeschylus"
    assert passages[0].speaker == "A"
    assert "Words in a speech" in passages[0].text


def test_parse_tei_prose_hierarchy(tmp_path: Path) -> None:
    path = tmp_path / "tlg0003.tlg001.perseus-eng1.xml"
    path.write_text(
        """
        <TEI xmlns="http://www.tei-c.org/ns/1.0">
          <teiHeader><fileDesc><titleStmt><title>History</title><author>Thucydides</author></titleStmt></fileDesc></teiHeader>
          <text><body><div type="translation" n="urn:cts:greekLit:tlg0003.tlg001.perseus-eng1">
            <div subtype="book" n="1"><head>Book One</head><div subtype="chapter" n="2"><head>War Begins</head><div subtype="section" n="3"><p>Prose section.</p></div></div></div>
          </div></body></text>
        </TEI>
        """,
        encoding="utf-8",
    )
    passage = parse_tei(path)[0]
    assert passage.passage_ref == "1.2.3"
    assert [ancestor.level for ancestor in passage.hierarchy] == ["book", "chapter", "section"]
    assert passage.hierarchy[0].title == "Book One"
    assert passage.hierarchy[1].title == "War Begins"
    assert identify_canonical_unit(passage).level == "section"


def test_parse_tei_prefers_text_language_over_header_language(tmp_path: Path) -> None:
    path = tmp_path / "tlg0074.tlg001.perseus-grc2.xml"
    path.write_text(
        """
        <TEI xmlns="http://www.tei-c.org/ns/1.0">
          <teiHeader xml:lang="eng">
            <fileDesc><titleStmt><title>Anabasis</title><author>Arrian</author></titleStmt></fileDesc>
            <profileDesc><langUsage><language ident="grc">Greek</language><language ident="lat">Latin</language></langUsage></profileDesc>
          </teiHeader>
          <text><body><div type="edition" n="urn:cts:greekLit:tlg0074.tlg001.perseus-grc2" xml:lang="grc">
            <div subtype="book" n="6"><div subtype="chapter" n="26"><div subtype="section" n="3"><p>λόγος Ἑλληνικός.</p></div></div></div>
          </div></body></text>
        </TEI>
        """,
        encoding="utf-8",
    )
    passage = parse_tei(path)[0]
    assert passage.language == "grc"


def test_parse_tei_epic_lines(tmp_path: Path) -> None:
    path = tmp_path / "tlg0012.tlg001.perseus-eng1.xml"
    path.write_text(
        """
        <TEI xmlns="http://www.tei-c.org/ns/1.0">
          <teiHeader><fileDesc><titleStmt><title>Iliad</title><author>Homer</author></titleStmt></fileDesc></teiHeader>
          <text><body><div type="translation" n="urn:cts:greekLit:tlg0012.tlg001.perseus-eng1">
            <div subtype="book" n="1"><div subtype="card" n="1"><l n="1">Sing, goddess.</l></div></div>
          </div></body></text>
        </TEI>
        """,
        encoding="utf-8",
    )
    passage = parse_tei(path)[0]
    assert passage.passage_ref == "1.1.1"
    assert "Sing" in passage.text


def test_catalog_metadata_uses_perseus_catalog() -> None:
    repo = Path(__file__).resolve().parents[2]
    path = repo / "data-sources/greekLit_data/data/tlg0012/tlg002/tlg0012.tlg002.perseus-eng4.xml"
    metadata = metadata_for_path(path, "Homer", "The Odyssey")
    assert metadata.author_name == "Homer"
    assert metadata.work_title == "Odyssey"
    assert metadata.genre == "epic"
    assert metadata.period == "Archaic"


def test_build_embedding_text_includes_metadata_and_hierarchy_titles() -> None:
    text = build_embedding_text(
        {
            "author": "Homer",
            "work": "Odyssey",
            "genre": "epic",
            "period": "Archaic",
            "language": "eng",
            "text_type": "translation",
            "passage_ref": "6.48-6.288",
            "metadata": {
                "hierarchy": [
                    {"level": "book", "ref": "6", "title": "Nausicaa"},
                    {"level": "section", "ref": "6.48", "title": None},
                ]
            },
            "text": "The stranger came before Nausicaa.",
        }
    )
    assert f"Embedding input version: {EMBEDDING_INPUT_VERSION}" in text
    assert "Author: Homer" in text
    assert "Work: Odyssey" in text
    assert "Hierarchy: book 6 - Nausicaa > section 6.48" in text
    assert "The stranger came before Nausicaa." in text


def test_chunk_text_splits_paragraph_boundaries_when_over_budget() -> None:
    paragraphs = [
        " ".join(f"alpha{i}" for i in range(10)),
        " ".join(f"beta{i}" for i in range(10)),
        " ".join(f"gamma{i}" for i in range(10)),
    ]
    chunks = chunk_text("\n\n".join(paragraphs), "1.1", token_budget=18, paragraphs=paragraphs)
    assert len(chunks) == 3
    assert [chunk.passage_ref for chunk in chunks] == ["1.1a", "1.1b", "1.1c"]


def test_chunk_text_splits_sentences_when_over_budget() -> None:
    text = "One two three four. Five six seven eight. Nine ten eleven twelve."
    chunks = chunk_text(text, "1", token_budget=8)
    assert len(chunks) > 1
    assert all(not chunk.passage_ref_synthetic for chunk in chunks)


def test_chunk_text_uses_sliding_window_for_long_sentence() -> None:
    text = " ".join(f"word{i}" for i in range(100))
    chunks = chunk_text(text, "1", token_budget=20)
    assert len(chunks) > 1
    assert any(chunk.passage_ref_synthetic for chunk in chunks)


def test_group_short_chunks_and_hierarchy_integrity() -> None:
    chunks = [chunk_text("short text", str(index))[0] for index in range(3)]
    grouped = group_short_chunks(chunks, floor_words=1)
    assert grouped
    leaves = [
        SemanticNode(
            id=f"passage:{index}",
            parent_id=None,
            level="passage",
            cts_urn=f"urn:cts:test:{index}",
            passage_ref_range=str(index),
            token_count=chunk.token_count,
            passage_id=f"p{index}",
        )
        for index, chunk in enumerate(grouped)
    ]
    nodes = build_basic_hierarchy("a1", "w1", leaves)
    ids = {node.id for node in nodes}
    assert all(node.parent_id is None or node.parent_id in ids for node in nodes)


def test_build_canonical_hierarchy_has_complete_parent_chain() -> None:
    leaf = SemanticNode(
        id="node:passage:1",
        parent_id=None,
        level="passage",
        cts_urn="urn:cts:greekLit:tlg0012.tlg002.perseus-eng4:1.1",
        passage_ref_range="1.1",
        token_count=100,
        passage_id="passage:1",
    )
    nodes = build_canonical_hierarchy(
        "author:greekLit:tlg0012",
        "work:greekLit:tlg0012.tlg002",
        [
            (
                leaf,
                (
                    CanonicalAncestor("book", "1", "urn:cts:greekLit:tlg0012.tlg002.perseus-eng4:1"),
                    CanonicalAncestor("section", "1.1", "urn:cts:greekLit:tlg0012.tlg002.perseus-eng4:1.1"),
                ),
            )
        ],
    )
    ids = {node.id for node in nodes}
    assert {"node:author:greekLit:tlg0012", "node:work:greekLit:tlg0012.tlg002"} <= ids
    assert all(node.parent_id is None or node.parent_id in ids for node in nodes)
