from __future__ import annotations

import argparse

from m2_segmenter.rechunker import chunk_text
from run_m1 import main as run_m1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="?")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--persist", action="store_true")
    args = parser.parse_args()
    if args.persist:
        import sys

        sys.argv = ["run_m1.py", "--persist", *(["--limit", str(args.limit)] if args.limit else [])]
        run_m1()
        return
    if not args.text:
        parser.error("text is required unless --persist is passed")
    for chunk in chunk_text(args.text, "1"):
        print(chunk)


if __name__ == "__main__":
    main()
