import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resourceBody,
  enrichField,
  validateValue,
  portableRecord,
  safeDisplay,
} from "../../apps/web/src/resource-model.mjs";
const spec = JSON.parse(
  fs.readFileSync(
    new URL("../../contracts/contextforge/web-contract.json", import.meta.url),
  ),
);
const ref = (name) => ({ $ref: "#/components/schemas/" + name });
test("server nullable visibility and role scope expose finite choices", () => {
  const field = spec.components.schemas.ServerCreate.properties.visibility;
  assert.deepEqual(enrichField("visibility", field, spec).enum, [
    "private",
    "team",
    "public",
  ]);
  assert.deepEqual(
    enrichField(
      "scope",
      spec.components.schemas.RoleCreateRequest.properties.scope,
      spec,
    ).enum,
    ["global", "team", "personal"],
  );
});
test("wrapped server preflight reports team and required-field problems before requests", () => {
  const schema =
    spec.paths["/v1/servers"].post.requestBody.content["application/json"]
      .schema;
  assert.equal(resourceBody(schema, spec).wrapper, "server");
  const errors = validateValue(
    { server: { name: " ", visibility: "team" } },
    schema,
    spec,
  );
  assert.ok(errors.some((v) => v.includes("name")));
  assert.ok(errors.some((v) => v.includes("所属团队")));
  assert.deepEqual(
    validateValue(
      { server: { name: "valid", visibility: "private" } },
      schema,
      spec,
    ),
    [],
  );
});
test("key import preflight validates nested permissions, expiry and source IPs", () => {
  const errors = validateValue(
    {
      name: "app",
      expires_in_days: 0,
      scope: {
        permissions: "tools.read",
        ip_restrictions: ["192.168.999.1", "10.0.0.1/33", "::1/129"],
      },
    },
    ref("TokenCreateRequest"),
    spec,
  );
  assert.ok(errors.some((v) => v.includes("expires_in_days")));
  assert.ok(errors.some((v) => v.includes("permissions")));
  assert.equal(errors.filter((v) => v.includes("有效 IP")).length, 3);
  assert.deepEqual(
    validateValue(
      {
        name: "app",
        scope: { permissions: [], ip_restrictions: ["::1/128", "10.0.0.0/8"] },
      },
      ref("TokenCreateRequest"),
      spec,
    ),
    [],
  );
});
test("portable definitions remove secrets recursively but retain model token limits and normal tags", () => {
  const provider = portableRecord(
    {
      id: "old",
      name: "model",
      provider_type: "openai",
      api_key: "secret",
      default_max_tokens: 2048,
      config: { api_key: "nested", region: "eu" },
    },
    ref("LLMProviderCreate"),
    spec,
  );
  assert.deepEqual(provider, {
    name: "model",
    provider_type: "openai",
    default_max_tokens: 2048,
    config: { region: "eu" },
  });
  const gateway = portableRecord(
    {
      name: "g",
      url: "https://example.com",
      authType: "bearer",
      authToken: "secret",
      tags: [{ id: "x", label: "tag" }],
    },
    ref("GatewayCreate"),
    spec,
  );
  assert.equal(gateway.authType, "none");
  assert.deepEqual(gateway.tags, ["tag"]);
  assert.equal(gateway.authToken, undefined);
  assert.deepEqual(validateValue(gateway, ref("GatewayCreate"), spec), []);
});
test("server portable definitions preserve read-model associations and team aliases", () => {
  const record = portableRecord(
    {
      name: "server",
      associatedTools: ["display-name"],
      associatedToolIds: ["tool-id"],
      associatedResources: ["resource-id"],
      associatedPrompts: ["prompt-id"],
      associatedA2aAgents: ["agent-id"],
      teamId: "team-id",
      visibility: "team",
    },
    ref("ServerCreate"),
    spec,
  );
  assert.deepEqual(record, {
    name: "server",
    associated_tools: ["tool-id"],
    associated_resources: ["resource-id"],
    associated_prompts: ["prompt-id"],
    associated_a2a_agents: ["agent-id"],
    team_id: "team-id",
    visibility: "team",
  });
  assert.deepEqual(validateValue(record, ref("ServerCreate"), spec), []);
});

test("A2A exports remove snake-case and camel-case authentication without losing public configuration", () => {
  const credentials = {
    auth_username: "synthetic-audit-user",
    auth_password: "synthetic-audit-password",
    auth_token: "synthetic-audit-token",
    auth_header_key: "X-Custom-Auth",
    auth_header_value: "synthetic-audit-header",
    auth_headers: [{ key: "X-Custom", value: "synthetic-audit-custom" }],
    auth_query_param_key: "custom",
    auth_query_param_value: "synthetic-audit-query",
    auth_value: "synthetic-audit-value",
  };
  for (const camelCase of [false, true]) {
    const input = {
      name: "public-agent",
      endpoint_url: "https://example.com/agent",
      auth_type: "authheaders",
      ...credentials,
    };
    const record = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        camelCase
          ? key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
          : key,
        value,
      ]),
    );
    const exported = portableRecord(record, ref("A2AAgentCreate"), spec);
    assert.deepEqual(exported, {
      name: "public-agent",
      endpoint_url: "https://example.com/agent",
      auth_type: "none",
    });
    assert.deepEqual(validateValue(exported, ref("A2AAgentCreate"), spec), []);
  }
});

test("portable nested configuration and snapshots redact authentication aliases consistently", () => {
  const config = {
    auth_username: "synthetic-audit-user",
    authHeaderValue: "synthetic-audit-header",
    entries: [{ auth_value: "synthetic-audit-value", total_tokens: 12 }],
    region: "eu",
  };
  const exported = portableRecord(
    { name: "provider", provider_type: "openai", config },
    ref("LLMProviderCreate"),
    spec,
  );
  assert.deepEqual(exported.config, {
    entries: [{ total_tokens: 12 }],
    region: "eu",
  });
  const display = safeDisplay(config);
  assert.equal(display.auth_username, "••••••");
  assert.equal(display.authHeaderValue, "••••••");
  assert.equal(display.entries[0].auth_value, "••••••");
  assert.equal(display.entries[0].total_tokens, 12);
});
test("display redaction hides custom header credentials without hiding token usage counts", () => {
  const value = safeDisplay({
    total_tokens: 12,
    default_max_tokens: 2048,
    token: "private",
    headers: { "X-API-Key": "private" },
    authHeaders: [{ key: "custom", value: "private" }],
    url: "https://user:password@example.com/mcp?token=secret&limit=2",
  });
  assert.equal(value.total_tokens, 12);
  assert.equal(value.default_max_tokens, 2048);
  assert.equal(value.token, "••••••");
  assert.equal(value.headers["X-API-Key"], "••••••");
  assert.equal(value.authHeaders, "••••••");
  assert.ok(!value.url.includes("password"));
  assert.ok(!value.url.includes("secret"));
});
