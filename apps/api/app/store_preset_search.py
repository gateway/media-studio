"""Literal token recall and deterministic ranking for saved Media Presets."""
from __future__ import annotations

from typing import Any


def normalize_search_text(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def preset_search_sql(query: str | None) -> tuple[str, list[str], str, list[str]]:
    normalized = normalize_search_text(query)
    tokens = list(dict.fromkeys(normalized.split()))[:60]
    if not tokens:
        return "", [], "", []
    columns = ("key", "label", "COALESCE(description, '')")
    patterns = ["%" + token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for token in tokens]
    match = lambda column: f"lower({column}) LIKE ? ESCAPE '\\'"
    clause = " AND ".join("(" + " OR ".join(match(column) for column in columns) + ")" for _ in tokens)
    parameters = [pattern for pattern in patterns for _ in columns]
    order = ["(preset_search_normalize(key) = ?) DESC", "(preset_search_normalize(label) = ?) DESC"]
    order_parameters = [normalized, normalized]
    for column in (columns[1], columns[0], columns[2]):
        order.append("(" + " + ".join(f"CASE WHEN {match(column)} THEN 1 ELSE 0 END" for _ in tokens) + ") DESC")
        order_parameters.extend(patterns)
    return clause, parameters, ", ".join(order) + ", ", order_parameters
