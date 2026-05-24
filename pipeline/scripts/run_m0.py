from __future__ import annotations

import argparse
from pathlib import Path

from m0_license.overrides import load_overrides
from m0_license.scanner import scan_file
from perseus_pipeline.db import connect
from perseus_pipeline.paths import iter_corpus_xml, iter_translation_xml, resolve_source_repo
from perseus_pipeline.persist import persist_license_decision


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--persist", action="store_true")
    parser.add_argument("--language", default=None)
    parser.add_argument("--cc-only", action="store_true")
    args = parser.parse_args()
    override_path = Path(__file__).resolve().parents[1] / "src" / "m0_license" / "overrides.yaml"
    overrides = load_overrides(override_path)
    candidates = iter_translation_xml(args.language) if args.language else iter_corpus_xml()
    files = []
    for path in candidates:
        if args.cc_only:
            repo = resolve_source_repo("greek" if "greek" in path.as_posix() else "latin")
            decision = scan_file(path, repo, overrides)
            if decision.decision != "cc_compatible":
                continue
        files.append(path)
        if args.limit and len(files) >= args.limit:
            break
    if args.persist:
        with connect() as conn:
            for path in files:
                repo = resolve_source_repo("greek" if "greek" in path.as_posix() else "latin")
                decision = scan_file(path, repo, overrides)
                persist_license_decision(conn, decision)
            conn.commit()
        print(f"Persisted {len(files)} license audit rows")
        return

    for path in files:
        repo = resolve_source_repo("greek" if "greek" in path.as_posix() else "latin")
        print(scan_file(path, repo, overrides))


if __name__ == "__main__":
    main()
