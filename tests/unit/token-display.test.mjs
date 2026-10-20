import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeTokenRevocation,
  tokenState,
} from "../../apps/web/src/token-display.mjs";

test("revocation takes precedence over the active flag", () => {
  assert.equal(tokenState({ is_active: true, is_revoked: true }), "revoked");
  assert.equal(tokenState({ is_active: false }), "disabled");
  assert.equal(tokenState({ is_active: true }), "available");
  assert.equal(tokenState({}), "available");
  assert.equal(
    tokenState({ is_revoked: "true", is_active: true }),
    "available",
  );
});

test("same-token detail keeps list revocation evidence and current detail fields", () => {
  const listItem = {
    id: "fake-token-one",
    name: "list name",
    is_active: true,
    is_revoked: true,
    revoked_at: "2026-10-19T10:00:00Z",
    revoked_by: "fixture-admin",
    revocation_reason: "fixture reason",
  };
  const detail = {
    id: "fake-token-one",
    name: "detail name",
    description: "latest detail value",
    is_active: true,
    is_revoked: false,
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
  };

  const merged = mergeTokenRevocation(listItem, detail);

  assert.deepEqual(merged, {
    ...detail,
    is_revoked: true,
    revoked_at: listItem.revoked_at,
    revoked_by: listItem.revoked_by,
    revocation_reason: listItem.revocation_reason,
  });
  assert.equal(merged.name, "detail name");
  assert.equal(merged.description, "latest detail value");
  assert.equal(detail.is_revoked, false);
  assert.equal(listItem.is_revoked, true);
});

test("revocation evidence is not transferred between different token IDs", () => {
  const listItem = {
    id: "fake-token-one",
    is_revoked: true,
    revoked_at: "2026-10-19T10:00:00Z",
    revoked_by: "fixture-admin",
    revocation_reason: "fixture reason",
  };
  const detail = {
    id: "fake-token-two",
    name: "other token",
    is_active: true,
    is_revoked: false,
  };

  assert.equal(mergeTokenRevocation(listItem, detail), detail);
});
