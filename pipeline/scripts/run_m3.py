from __future__ import annotations

import argparse
import time
from pathlib import Path

from m3_embedder.db_embedder import aggregate_all, embed_leaf_nodes
from perseus_pipeline.db import connect


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--aggregates-only", action="store_true")
    parser.add_argument("--force", action="store_true", help="Recompute leaf embeddings even when an embedding already exists")
    parser.add_argument("--retry-on-quota", action="store_true", help="Sleep and resume when Gemini returns a quota error")
    parser.add_argument("--quota-sleep-seconds", type=int, default=70)
    parser.add_argument("--max-quota-retries", type=int, default=40)
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "cache" / "embeddings",
    )
    args = parser.parse_args()
    with connect() as conn:
        embedded = 0
        stop_reason = None
        if not args.aggregates_only:
            quota_retries = 0
            while True:
                current, stop_reason = embed_leaf_nodes(conn, args.cache_dir, args.limit, force=args.force)
                embedded += current
                if stop_reason != "gemini_quota_exhausted" or not args.retry_on_quota:
                    break
                quota_retries += 1
                if quota_retries > args.max_quota_retries:
                    break
                time.sleep(args.quota_sleep_seconds)
        aggregates = aggregate_all(conn) if args.aggregates_only or stop_reason is None else {}
        conn.commit()
    print(
        {
            "embedded_leaf_nodes": embedded,
            "aggregated_nodes": aggregates,
            "dimension": 768,
            "stop_reason": stop_reason,
        }
    )


if __name__ == "__main__":
    main()
