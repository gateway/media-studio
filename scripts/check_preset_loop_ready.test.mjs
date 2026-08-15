import assert from "node:assert/strict";
import test from "node:test";

import { classifyFetchError, classifyHealthResponse } from "./check_preset_loop_ready.mjs";

function fetchError(code) {
  const error = new TypeError("fetch failed");
  error.cause = { code };
  return error;
}

test("readiness classifies refused connections separately from environment blocks", () => {
  assert.equal(classifyFetchError(fetchError("ECONNREFUSED")), "connection_refused");
  for (const code of ["EPERM", "EACCES", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND"]) {
    assert.equal(classifyFetchError(fetchError(code)), "environment_blocked");
  }
});

test("readiness distinguishes unhealthy and unexpected HTTP responses", () => {
  assert.equal(classifyHealthResponse({ ok: false, status: 503 }, { status: "error" }), "server_unhealthy");
  assert.equal(classifyHealthResponse({ ok: true, status: 200 }, { status: "degraded" }), "server_unhealthy");
  assert.equal(classifyHealthResponse({ ok: true, status: 200 }, "not-json"), "unexpected_response");
  assert.equal(classifyHealthResponse({ ok: true, status: 200 }, { status: "ok" }), "ready");
});
