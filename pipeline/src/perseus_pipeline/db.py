from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg


def database_url() -> str:
    return os.getenv("DATABASE_URL", "postgresql://perseus:perseus@localhost:5432/perseus")


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_url()) as conn:
        yield conn
