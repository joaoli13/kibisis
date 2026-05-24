from __future__ import annotations

import argparse
import sys

from run_m0 import main as run_m0
from run_m1 import main as run_m1
from run_m5 import main as run_m5


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--persist", action="store_true")
    parser.add_argument("--skip-m5", action="store_true")
    parser.add_argument("--language", default=None)
    parser.add_argument("--cc-only", action="store_true")
    args = parser.parse_args()

    common = [
        *(["--limit", str(args.limit)] if args.limit else []),
        *(["--language", args.language] if args.language else []),
        *(["--cc-only"] if args.cc_only else []),
    ]
    sys.argv = ["run_m0.py", *common, *(["--persist"] if args.persist else [])]
    run_m0()
    sys.argv = ["run_m1.py", *common, *(["--persist"] if args.persist else [])]
    run_m1()
    if args.skip_m5:
        return
    run_m5()


if __name__ == "__main__":
    main()
