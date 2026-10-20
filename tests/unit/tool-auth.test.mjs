import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toolWriteRecord,
  toolWriteBody,
  toolEditContext,
  toolAuthenticationProblems,
} from "../../apps/web/src/tool-auth.mjs";
import { validateValue } from "../../apps/web/src/resource-model.mjs";
import { resolveSchema } from "../../packages/api-client/contract.mjs";
const spec = JSON.parse(
  readFileSync("contracts/contextforge/web-contract.json", "utf8"),
);

test("tool credential inputs map to flat backend write fields and omit obsolete methods", () => {
  const base = { name: "tool", visibility: "public" };
  assert.deepEqual(
    toolWriteRecord({
      ...base,
      auth: {
        authType: "basic",
        username: "demo",
        password: "demo-pass",
        token: "obsolete",
      },
    }),
    {
      ...base,
      auth_type: "basic",
      auth_username: "demo",
      auth_password: "demo-pass",
    },
  );
  assert.deepEqual(
    toolWriteBody({
      tool: {
        ...base,
        auth: { authType: "bearer", token: "demo-token", password: "obsolete" },
      },
      team_id: "team-1",
    }),
    {
      tool: { ...base, auth_type: "bearer", auth_token: "demo-token" },
      team_id: "team-1",
    },
  );
  assert.deepEqual(
    toolWriteRecord({
      ...base,
      auth: {
        authType: "authheaders",
        authHeaderKey: "X-Legacy",
        authHeaderValue: "unused",
        authHeaders: [{ key: " X-Api-Key ", value: "demo-value" }],
      },
    }),
    {
      ...base,
      auth_type: "authheaders",
      auth_headers: [{ key: "X-Api-Key", value: "demo-value" }],
    },
  );
  assert.deepEqual(
    toolWriteRecord({
      ...base,
      auth: {
        authType: "authheaders",
        authHeaderKey: "X-Api-Key",
        authHeaderValue: "demo-value",
      },
    }),
    {
      ...base,
      auth_type: "authheaders",
      auth_headers: [{ key: "X-Api-Key", value: "demo-value" }],
    },
  );
});

test("untouched credentials remain omitted and explicit none clears both stored auth fields", () => {
  const unchanged = { description: "updated" };
  assert.equal(toolWriteRecord(unchanged), unchanged);
  assert.deepEqual(toolWriteRecord({ ...unchanged, auth: {} }), unchanged);
  assert.deepEqual(
    toolWriteRecord({
      ...unchanged,
      auth: { authType: "none", token: "obsolete" },
    }),
    { ...unchanged, auth: { authType: "none", authValue: "" } },
  );
  const encoded = {
    auth: { authType: "bearer", authValue: "explicit-encoded-value" },
  };
  assert.equal(toolWriteRecord(encoded), encoded);
});

test("tool authentication validation rejects incomplete replacements and malformed headers", () => {
  for (const auth of [
    { authType: "basic", username: "demo" },
    { authType: "bearer" },
    { authType: "authheaders" },
    { authType: "authheaders", authHeaderKey: 123, authHeaderValue: "demo" },
    {
      authType: "authheaders",
      authHeaders: [{ key: "bad key", value: "demo" }],
    },
    { authType: "authheaders", authHeaders: [{ key: "X-Api-Key", value: "" }] },
    { authType: "oauth" },
  ]) {
    assert.ok(toolAuthenticationProblems(auth).length);
    assert.throws(() => toolWriteRecord({ auth }));
    assert.ok(
      validateValue(auth, spec.components.schemas.AuthenticationValues, spec)
        .length,
    );
  }
  assert.deepEqual(toolAuthenticationProblems(undefined), []);
  assert.deepEqual(toolAuthenticationProblems({}), []);
});

test("tool edit validation uses immutable GET team context without adding team fields to PUT", () => {
  const update = resolveSchema(
    spec.paths["/v1/tools/{tool_id}"].put.requestBody.content[
      "application/json"
    ].schema,
    spec,
  );
  assert.equal(update.properties.teamId, undefined);
  assert.equal(update.properties.team_id, undefined);
  const context = toolEditContext({
    teamId: "team-1",
    team: { name: "Example team" },
    auth: { authType: "bearer", token: "masked-token" },
  });
  assert.deepEqual(context, {
    teamId: "team-1",
    teamName: "Example team",
    authType: "bearer",
  });
  const body = { visibility: "team", description: "updated" };
  assert.deepEqual(
    validateValue(body, update, spec, "", false, {
      teamId: context.teamId,
      teamReadOnly: true,
    }),
    [],
  );
  assert.deepEqual(body, { visibility: "team", description: "updated" });
  assert.match(
    validateValue(body, update, spec, "", false, { teamReadOnly: true })[0],
    /不支持更换所属团队/,
  );
  assert.ok(validateValue(body, update, spec).length);
  assert.deepEqual(toolEditContext({ team_id: "team-snake" }), {
    teamId: "team-snake",
    teamName: "",
    authType: "none",
  });
});
