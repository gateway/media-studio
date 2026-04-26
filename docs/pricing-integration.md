# Pricing Integration

Media Studio treats `kie-api` as the pricing source of truth. The web app should not duplicate model-specific pricing math except as an instant preview fallback while waiting for the server response.

## Runtime Contract

- `GET /media/pricing` returns the normalized KIE pricing snapshot.
- `POST /media/pricing/estimate` returns the canonical request estimate used by the Generate button and persisted batch/job pricing summaries.
- `POST /media/pricing/refresh` remains the manual admin refresh action.
- `MEDIA_PRICING_CACHE_HOURS` controls the stale window for cached/resource pricing snapshots.
- `MEDIA_PRICING_REFRESH_ON_STARTUP=1` lets the API refresh stale pricing once during startup.
- `MEDIA_STUDIO_KIE_API_REPO_PATH` points Media Studio at the local `kie-api` checkout to load the newest registry, specs, pricing resources, and refresh code.

If live KIE pricing refresh fails, the API falls back to the bundled or cached snapshot and includes `refresh_error` plus a note in the response. Startup should not fail just because pricing refresh failed.

## Coverage Metadata

Media Studio passes through additive KIE metadata:

- `priced_model_keys`: supported model keys with a pricing rule.
- `missing_model_keys`: supported model keys without a pricing rule.
- `unmapped_source_rows`: KIE pricing rows that looked relevant to supported models but were not safely mapped.
- `is_stale`: whether the current snapshot is outside the configured freshness window.

The `/pricing` admin page surfaces these as operator warnings. This is intentionally visible because a new model should not silently appear without pricing coverage.

## Estimate Rules

Server estimates are canonical. The frontend helper `estimateFromPricingSnapshot(...)` exists only for instant local preview and testable UI fallbacks.

For GPT Image 2, the current KIE site-pricing snapshot exposes observed, non-authoritative planning estimates:

- `1K`: 6 credits / $0.03 per output
- `2K`: 10 credits / $0.05 per output
- `4K`: 16 credits / $0.08 per output

These rows are `observed_site_pricing`, not verified actual billed-credit reconciliation. Actual-vs-estimated billing reconciliation is a later slice.
