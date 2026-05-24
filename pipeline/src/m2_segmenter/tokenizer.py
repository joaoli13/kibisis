from __future__ import annotations

import re
import os
from functools import lru_cache


@lru_cache(maxsize=1)
def _gemini_model():
    if os.getenv("PERSEUS_USE_GEMINI_TOKENIZER") != "1" or not os.getenv("GEMINI_API_KEY"):
        return None
    try:
        import google.generativeai as genai
    except Exception:
        return None
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    return genai.GenerativeModel("gemini-embedding-001")


def estimate_token_count(text: str, language: str | None = None) -> int:
    model = _gemini_model()
    if model is not None:
        try:
            result = model.count_tokens(text)
            total = getattr(result, "total_tokens", None)
            if isinstance(total, int) and total > 0:
                return total
        except Exception:
            pass
    words = re.findall(r"\S+", text)
    multiplier = 1.6 if language in {"grc", "lat"} else 1.3
    return max(1, int(len(words) * multiplier))
