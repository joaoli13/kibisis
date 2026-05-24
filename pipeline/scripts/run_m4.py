from __future__ import annotations

from m4_clusterer.db_projector import project_embedded_nodes
from perseus_pipeline.db import connect


def main() -> None:
    with connect() as conn:
        result = project_embedded_nodes(conn)
        conn.commit()
    print(result)


if __name__ == "__main__":
    main()
