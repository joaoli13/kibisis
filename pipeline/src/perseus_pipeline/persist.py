from __future__ import annotations

import hashlib
import re
from pathlib import Path

from psycopg import Connection
from psycopg.types.json import Jsonb

from m0_license.scanner import LicenseDecision
from m1_ingestor import ParsedPassage
from m1_ingestor.catalog import metadata_for_path
from m2_segmenter.rechunker import Chunk


def stable_id(*parts: str | None) -> str:
    raw = "|".join(part or "" for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _safe_ref(value: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value or "unknown")


def text_type_for_language(language: str) -> str:
    return "original" if language in {"grc", "lat"} else "translation"


def _passage_metadata(parsed: ParsedPassage) -> dict[str, object]:
    metadata: dict[str, object] = {}
    if parsed.hierarchy:
        metadata["hierarchy"] = [
            {"level": item.level, "ref": item.ref, "cts_urn": item.cts_urn, "title": item.title}
            for item in parsed.hierarchy
        ]
    if parsed.speaker:
        metadata["speaker"] = parsed.speaker
    return metadata


def persist_license_decision(conn: Connection, decision: LicenseDecision) -> None:
    conn.execute(
        """
        INSERT INTO licenses_audit (
          file_path, declared_license, decision, decision_reason, license_source,
          edition_year, translator, is_public_domain_original, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (file_path) DO UPDATE SET
          declared_license = excluded.declared_license,
          decision = excluded.decision,
          decision_reason = excluded.decision_reason,
          license_source = excluded.license_source,
          edition_year = excluded.edition_year,
          translator = excluded.translator,
          is_public_domain_original = excluded.is_public_domain_original,
          updated_at = now()
        """,
        (
            decision.file_path,
            decision.declared_license,
            decision.decision,
            decision.decision_reason,
            decision.license_source,
            decision.edition_year,
            decision.translator,
            decision.is_public_domain_original,
        ),
    )


def persist_passage_chunk(
    conn: Connection,
    source_path: Path,
    parsed: ParsedPassage,
    chunk: Chunk,
    license_status: str,
    chunk_index: int,
) -> str:
    catalog = metadata_for_path(source_path, parsed.author, parsed.work)
    author_name = catalog.author_name or parsed.author or catalog.author_code
    work_title = catalog.work_title or parsed.work or source_path.stem
    language = parsed.language or "unknown"
    text_type = text_type_for_language(language)
    author_id = catalog.author_id
    work_id = catalog.work_id
    edition_id = catalog.edition_id
    passage_id = f"passage:{stable_id(str(source_path), parsed.passage_ref, str(chunk_index), chunk.text)}"
    node_id = f"node:{passage_id}"
    conn.execute(
        """
        INSERT INTO authors(id, name, name_variants, wikidata_id)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          name_variants = excluded.name_variants,
          wikidata_id = excluded.wikidata_id
        """,
        (author_id, author_name, list(catalog.name_variants or (author_name,)), catalog.wikidata_id),
    )
    conn.execute(
        """
        INSERT INTO works(id, author_id, title, cts_urn, language, genre, period, date_hint)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          title = excluded.title,
          language = excluded.language,
          genre = excluded.genre,
          period = excluded.period,
          date_hint = excluded.date_hint
        """,
        (work_id, author_id, work_title, catalog.work_urn, language, catalog.genre, catalog.period, catalog.date_hint),
    )
    conn.execute(
        """
        INSERT INTO editions(
          id, work_id, cts_urn, language, text_type, source_path,
          edition_year, translator, license_status
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          edition_year = excluded.edition_year,
          translator = excluded.translator,
          license_status = excluded.license_status
        """,
        (
            edition_id,
            work_id,
            catalog.edition_urn,
            language,
            text_type,
            str(source_path),
            parsed.edition_year,
            parsed.translator,
            license_status,
        ),
    )
    conn.execute(
        """
        INSERT INTO passages(
          id, edition_id, author_id, work_id, cts_urn, passage_ref,
          passage_ref_synthetic, text, language, text_type, token_count,
          source_path, license_status, genre, period, metadata
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          text = excluded.text,
          token_count = excluded.token_count,
          license_status = excluded.license_status,
          genre = excluded.genre,
          period = excluded.period,
          metadata = excluded.metadata,
          updated_at = now()
        """,
        (
            passage_id,
            edition_id,
            author_id,
            work_id,
            parsed.cts_urn,
            chunk.passage_ref,
            chunk.passage_ref_synthetic,
            chunk.text,
            language,
            text_type,
            chunk.token_count,
            str(source_path),
            license_status,
            catalog.genre,
            catalog.period,
            Jsonb(_passage_metadata(parsed)),
        ),
    )
    conn.execute(
        """
        INSERT INTO semantic_nodes(
          id, parent_id, level, cts_urn, passage_ref_range, author_id, work_id, passage_id,
          text_type, language, genre, period, token_count, aggregation_method, license_status, metadata
        )
        VALUES (%s, %s, 'passage', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'leaf', %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          parent_id = excluded.parent_id,
          token_count = excluded.token_count,
          license_status = excluded.license_status,
          genre = excluded.genre,
          period = excluded.period,
          metadata = excluded.metadata,
          updated_at = now()
        """,
        (
            node_id,
            None,
            parsed.cts_urn,
            chunk.passage_ref,
            author_id,
            work_id,
            passage_id,
            text_type,
            language,
            catalog.genre,
            catalog.period,
            chunk.token_count,
            license_status,
            Jsonb(_passage_metadata(parsed)),
        ),
    )
    return passage_id


def refresh_basic_hierarchy_nodes(conn: Connection) -> None:
    conn.execute("UPDATE semantic_nodes SET parent_id = NULL WHERE level = 'passage'")
    conn.execute("DELETE FROM semantic_nodes WHERE level IN ('section', 'chapter', 'book', 'work', 'author')")
    conn.execute(
        """
        INSERT INTO semantic_nodes(
          id, parent_id, level, cts_urn, author_id, token_count,
          aggregation_method, license_status, language, genre, period
        )
        SELECT
          'node:' || a.id,
          NULL,
          'author',
          'urn:cts:' || a.id,
          a.id,
          COALESCE(sum(p.token_count), 0)::int,
          'token_weighted_mean',
          CASE WHEN bool_or(p.license_status = 'cc_compatible') THEN 'cc_compatible' ELSE 'unknown' END,
          min(p.language),
          min(p.genre),
          min(p.period)
        FROM authors a
        LEFT JOIN passages p ON p.author_id = a.id
        GROUP BY a.id
        """
    )
    conn.execute(
        """
        INSERT INTO semantic_nodes(
          id, parent_id, level, cts_urn, author_id, work_id, token_count,
          aggregation_method, license_status, language, genre, period
        )
        SELECT
          'node:' || w.id,
          'node:' || w.author_id,
          'work',
          COALESCE(w.cts_urn, 'urn:cts:' || w.id),
          w.author_id,
          w.id,
          COALESCE(sum(p.token_count), 0)::int,
          'token_weighted_mean',
          CASE WHEN bool_or(p.license_status = 'cc_compatible') THEN 'cc_compatible' ELSE 'unknown' END,
          min(p.language),
          min(p.genre),
          min(p.period)
        FROM works w
        LEFT JOIN passages p ON p.work_id = w.id
        GROUP BY w.id, w.author_id, w.cts_urn
        """
    )
    rows = conn.execute(
        """
        SELECT id, author_id, work_id, passage_ref, cts_urn, token_count, license_status,
               language, genre, period, metadata
        FROM passages
        ORDER BY source_path, passage_ref, id
        """
    ).fetchall()
    aggregate_nodes: dict[str, dict[str, object]] = {}
    leaf_parents: dict[str, str] = {}
    for (
        passage_id,
        author_id,
        work_id,
        passage_ref,
        cts_urn,
        token_count,
        license_status,
        language,
        genre,
        period,
        metadata,
    ) in rows:
        hierarchy = (metadata or {}).get("hierarchy", []) if isinstance(metadata, dict) else []
        parent_id = f"node:{work_id}"
        for item in hierarchy:
            if not isinstance(item, dict):
                continue
            level = item.get("level")
            ref = str(item.get("ref") or "")
            if level not in {"book", "chapter", "section"} or not ref:
                continue
            node_id = f"node:{level}:{work_id}:{_safe_ref(ref)}"
            aggregate = aggregate_nodes.setdefault(
                node_id,
                {
                    "id": node_id,
                    "parent_id": parent_id,
                    "level": level,
                    "cts_urn": item.get("cts_urn") or cts_urn.rsplit(":", 1)[0],
                    "author_id": author_id,
                    "work_id": work_id,
                    "token_count": 0,
                    "license_statuses": set(),
                    "language": language,
                    "genre": genre,
                    "period": period,
                    "refs": [],
                },
            )
            aggregate["token_count"] = int(aggregate["token_count"]) + int(token_count or 0)
            aggregate["license_statuses"].add(license_status)
            aggregate["refs"].append(passage_ref)
            parent_id = node_id
        leaf_parents[passage_id] = parent_id

    level_order = {"book": 0, "chapter": 1, "section": 2}
    for aggregate in sorted(
        aggregate_nodes.values(), key=lambda item: (level_order[str(item["level"])], str(item["id"]))
    ):
        statuses = aggregate["license_statuses"]
        refs = aggregate["refs"]
        aggregate_license = "cc_compatible" if "cc_compatible" in statuses else ("restricted" if "restricted" in statuses else "unknown")
        ref_range = ""
        if refs:
            ref_range = str(refs[0]) if refs[0] == refs[-1] else f"{refs[0]}-{refs[-1]}"
        conn.execute(
            """
            INSERT INTO semantic_nodes(
              id, parent_id, level, cts_urn, passage_ref_range, author_id, work_id,
              token_count, aggregation_method, license_status, language, genre, period
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'token_weighted_mean', %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              parent_id = excluded.parent_id,
              passage_ref_range = excluded.passage_ref_range,
              token_count = excluded.token_count,
              license_status = excluded.license_status,
              language = excluded.language,
              genre = excluded.genre,
              period = excluded.period,
              updated_at = now()
            """,
            (
                aggregate["id"],
                aggregate["parent_id"],
                aggregate["level"],
                aggregate["cts_urn"],
                ref_range,
                aggregate["author_id"],
                aggregate["work_id"],
                aggregate["token_count"],
                aggregate_license,
                aggregate["language"],
                aggregate["genre"],
                aggregate["period"],
            ),
        )
    for passage_id, parent_id in leaf_parents.items():
        conn.execute(
            "UPDATE semantic_nodes SET parent_id = %s WHERE passage_id = %s AND level = 'passage'",
            (parent_id, passage_id),
        )
