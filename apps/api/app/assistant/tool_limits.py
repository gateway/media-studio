"""Shared delivery limit for assistant tool results and inspection evidence."""

KERNEL_TOOL_RESULT_MAX_BYTES = 32_768


def compact_tool_catalog(catalog: list[dict]) -> dict:
    """Keep complete contracts once; $ref remains rooted in this catalog document."""
    import copy

    definitions = {}
    tools = copy.deepcopy(catalog)
    for tool in tools:
        schema = tool["arguments_schema"]
        local = schema.get("$defs", {})
        if all(key not in definitions or definitions[key] == value for key, value in local.items()):
            definitions.update(local)
            schema.pop("$defs", None)
    return {"$defs": definitions, "tools": tools}
