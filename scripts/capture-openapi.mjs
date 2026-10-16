import { mkdir, writeFile, readFile } from "node:fs/promises";
const BASELINE_TAG = "v1.0.11";
const BASELINE_COMMIT = "077071bbb43599dd5ab9372ebdbb9a8e686a9816";
const BASELINE_TAG_OBJECT = "f918209a1788437b2508f9f8504eecd44bbc5cf5";
const base = (
  process.env.CONTRACT_BACKEND_URL || "http://127.0.0.1:4444"
).replace(/\/$/, "");
let token = process.env.CONTRACT_TOKEN;
if (!token && process.env.CONTRACT_USE_TEST_CREDENTIALS === "true") {
  const { email, password } = JSON.parse(
    await readFile(".cache/test-credentials.json", "utf8"),
  );
  const login = await fetch(`${base}/v1/auth/email/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok)
    throw new Error(`Test login failed: ${login.status} ${await login.text()}`);
  token = (await login.json()).access_token;
}
const headers = token ? { Authorization: `Bearer ${token}` } : {};
const response = await fetch(`${base}/openapi.json`, { headers });
if (!response.ok) throw new Error(`OpenAPI fetch failed: ${response.status}`);
const schema = await response.json();
if (!schema.openapi || !schema.paths)
  throw new Error("Not an OpenAPI document");
await mkdir("contracts/contextforge", { recursive: true });
await writeFile(
  "contracts/contextforge/openapi.json",
  JSON.stringify(schema, null, 2) + "\n",
);
await writeFile(
  "contracts/contextforge/provenance.json",
  JSON.stringify(
    {
      tag: BASELINE_TAG,
      commit: BASELINE_COMMIT,
      tagObject: BASELINE_TAG_OBJECT,
      source: "configured runtime /openapi.json",
      runtimeProvenanceVerified: false,
      backendVersion: schema.info?.version,
      capturedAt: new Date().toISOString(),
      note: `The tag and commit identify the checked-in ${BASELINE_TAG} panel baseline; this runtime capture does not verify that the configured endpoint is that commit. The annotated tag object is recorded separately as tagObject. Feature-gated routes depend on runtime configuration; see source-routes.json for the static inventory.`,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Captured ${Object.keys(schema.paths).length} paths; version ${schema.info?.version}`,
);
