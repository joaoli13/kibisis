from __future__ import annotations

import os
import time

import google.generativeai as genai


MODEL = "models/gemini-embedding-001"
OUTPUT_DIMENSIONALITY = 768


def embed_texts(texts: list[str], retries: int = 3, delay_seconds: float = 1.0) -> list[list[float]]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for embedding")
    if not texts:
        return []
    genai.configure(api_key=api_key)
    for attempt in range(retries):
        try:
            try:
                response = genai.embed_content(
                    model=MODEL,
                    content=texts,
                    task_type="retrieval_document",
                    output_dimensionality=OUTPUT_DIMENSIONALITY,
                )
            except TypeError:
                response = genai.embed_content(
                    model=MODEL,
                    content=texts,
                    task_type="retrieval_document",
                )
            embeddings = [[float(value) for value in embedding] for embedding in response["embedding"]]
            if len(embeddings) != len(texts):
                raise RuntimeError(f"Expected {len(texts)} embeddings, received {len(embeddings)}")
            for embedding in embeddings:
                if len(embedding) != OUTPUT_DIMENSIONALITY:
                    raise RuntimeError(
                        f"Expected {OUTPUT_DIMENSIONALITY}D embedding, received {len(embedding)}D"
                    )
            return embeddings
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(delay_seconds * (2**attempt))
    return []
