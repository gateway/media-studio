# Catalog and ownership

## Maintained source

The personal `media-studio-graph-builder` under the configured Codex skills directory (normally `~/.codex/skills`) is maintained here. Media Studio's `.codex/skills/media-studio-graph-builder` is a deliberate local distribution mirror. Use one resolved copy per task; do not combine their instructions. For skill maintenance, edit the personal source, then compare and explicitly copy its changed maintained files to the project mirror. Compare before overwriting to preserve independent edits. This local convention does not authorize publishing either copy.

Ordinary template work does not synchronize skills. Catalog refreshes belong in the personal source, followed by deliberate mirror synchronization when maintaining this installation.

## Snapshot limits

`node-catalog.json` is a compact discovery cache, not the authoritative live contract. A source URL proves neither the checkout nor the installation behind it. The inherited 51-node snapshot has no capture time or runtime revision; its freshness is unknown. The prior project snapshot contained installation-specific preset nodes, so their absence here is not evidence those nodes were removed from the app.

Search with `find_nodes.py` first. Its output is capped at 12 matches; narrow the query when the count is larger. Read only matching catalog entries when broad search is insufficient. Options can be truncated, and help text and other definition details are omitted. Use current full backend definitions for omitted data, installation-specific recipe/preset nodes or a runtime mismatch. If the runtime is unavailable, inspect the affected owning definition in the checkout and report runtime compatibility as unverified.

## Refresh

Before a refresh, follow the target project's runtime policy and confirm that the endpoint serves the intended running checkout and installation. An unchanged localhost port is insufficient. Do not start another instance or create a database just to refresh this cache.

Run `python3 <personal-skill-dir>/scripts/refresh_node_catalog.py <verified-node-definitions-url>`. The default URL is `http://127.0.0.1:3000/api/control/media/graph/node-definitions`; use it only after that confirmation. The script writes beside itself at `references/node-catalog.json`, so confirm the resolved destination first.

Review the resulting count, changed types and fields before distributing it. New captures include `captured_at` and `source_url`; record checkout/runtime evidence in the task report rather than treating the timestamp as proof of compatibility. Keep full runtime definitions out of the compact cache and do not union snapshots from different installations.
