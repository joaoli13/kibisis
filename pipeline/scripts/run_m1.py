from __future__ import annotations

import argparse
from pathlib import Path

from m0_license.overrides import load_overrides
from m0_license.scanner import scan_file
from m1_ingestor import ParsedPassage, parse_tei
from m2_segmenter.rechunker import Chunk, chunk_text
from perseus_pipeline.db import connect
from perseus_pipeline.paths import iter_corpus_xml, iter_translation_xml, resolve_source_repo
from perseus_pipeline.persist import persist_passage_chunk, refresh_basic_hierarchy_nodes


def _group_file_chunks(units: list[tuple[ParsedPassage, Chunk]], floor_words: int = 700) -> list[tuple[ParsedPassage, Chunk]]:
    grouped: list[tuple[ParsedPassage, Chunk]] = []
    current: list[tuple[ParsedPassage, Chunk]] = []

    def common_hierarchy(items: list[tuple[ParsedPassage, Chunk]]):
        if not items:
            return ()
        prefix = list(items[0][0].hierarchy)
        for parsed, _ in items[1:]:
            next_prefix = []
            for left, right in zip(prefix, parsed.hierarchy, strict=False):
                if left == right:
                    next_prefix.append(left)
                else:
                    break
            prefix = next_prefix
        return tuple(prefix)

    def flush() -> None:
        if not current:
            return
        first_parsed, first_chunk = current[0]
        last_chunk = current[-1][1]
        ref = first_chunk.passage_ref
        if len(current) > 1:
            ref = f"{first_chunk.passage_ref}-{last_chunk.passage_ref}"
        base_urn = first_parsed.cts_urn.rsplit(":", 1)[0]
        text = "\n".join(chunk.text for _, chunk in current)
        token_count = sum(chunk.token_count for _, chunk in current)
        parsed = ParsedPassage(
            cts_urn=f"{base_urn}:{ref}",
            passage_ref=ref,
            text=text,
            language=first_parsed.language,
            author=first_parsed.author,
            work=first_parsed.work,
            edition=first_parsed.edition,
            translator=first_parsed.translator,
            edition_year=first_parsed.edition_year,
            hierarchy=common_hierarchy(current),
            paragraphs=tuple(chunk.text for _, chunk in current),
            speaker=first_parsed.speaker,
        )
        chunk = Chunk(
            passage_ref=ref,
            text=text,
            token_count=token_count,
            passage_ref_synthetic=any(chunk.passage_ref_synthetic for _, chunk in current),
        )
        grouped.append((parsed, chunk))
        current.clear()

    def parent_key(parsed: ParsedPassage) -> str:
        if not parsed.hierarchy:
            return parsed.cts_urn.rsplit(":", 1)[0]
        for ancestor in parsed.hierarchy:
            if ancestor.level == "book":
                return ancestor.cts_urn
        return parsed.cts_urn.rsplit(":", 1)[0]

    for parsed, chunk in units:
        if current and parent_key(parsed) != parent_key(current[-1][0]):
            flush()
        if current and sum(item.token_count for _, item in current) + chunk.token_count > 1800:
            flush()
        current.append((parsed, chunk))
        if chunk.token_count >= 1800 or sum(len(item.text.split()) for _, item in current) >= floor_words:
            flush()
    flush()
    return grouped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path, nargs="?")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--persist", action="store_true")
    parser.add_argument("--language", default=None)
    parser.add_argument("--cc-only", action="store_true")
    args = parser.parse_args()
    candidates = [args.path] if args.path else (
        iter_translation_xml(args.language) if args.language else iter_corpus_xml()
    )
    override_path = Path(__file__).resolve().parents[1] / "src" / "m0_license" / "overrides.yaml"
    overrides = load_overrides(override_path)
    files = []
    decisions = {}
    for path in candidates:
        repo = resolve_source_repo("greek" if "greek" in path.as_posix() else "latin")
        decision = scan_file(path, repo, overrides)
        if args.cc_only and decision.decision != "cc_compatible":
            continue
        files.append(path)
        decisions[path] = decision
        if args.limit and len(files) >= args.limit:
            break

    if args.persist:
        persisted = 0
        with connect() as conn:
            for path in files:
                decision = decisions[path]
                units: list[tuple[ParsedPassage, Chunk]] = []
                for parsed in parse_tei(path):
                    for chunk in chunk_text(
                        parsed.text,
                        parsed.passage_ref,
                        parsed.language,
                        paragraphs=parsed.paragraphs,
                    ):
                        units.append((parsed, chunk))
                for index, (parsed, chunk) in enumerate(_group_file_chunks(units)):
                    persist_passage_chunk(conn, path, parsed, chunk, decision.decision, index)
                    persisted += 1
            refresh_basic_hierarchy_nodes(conn)
            conn.commit()
        print(f"Persisted {persisted} passage chunks from {len(files)} files")
        return

    for path in files:
        for passage in parse_tei(path):
            print(passage)


if __name__ == "__main__":
    main()
