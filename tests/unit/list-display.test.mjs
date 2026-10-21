import test from "node:test";
import assert from "node:assert/strict";
import {
  listPath,
  loadResourcePages,
  matchesResource,
  resourceTags,
  resourceStatus,
} from "../../apps/web/src/list-model.mjs";
import {
  formatDuration,
  formatTimestamp,
  formatOperationalValue,
  metricRows,
} from "../../apps/web/src/operations-display.mjs";

const operation = (...names) => ({
  path: "/list",
  parameters: names.map((name) => ({ name })),
});

test("list query follows declared pagination and filter capabilities", () => {
  assert.equal(
    listPath(operation("limit", "skip", "include_inactive"), {
      page: 2,
      team: "hidden",
      visibility: "private",
    }),
    "/list?include_inactive=true&limit=25&skip=50",
  );
  assert.equal(
    listPath(operation("page", "page_size", "enabled_only"), { page: 1 }),
    "/list?enabled_only=false&page_size=25&page=2",
  );
  const url = new URL(
    listPath(operation("cursor", "team_id", "visibility"), {
      cursor: "next&item",
      team: "team-a",
      visibility: "private",
    }),
    "http://panel",
  );
  assert.equal(url.searchParams.get("cursor"), "next&item");
  assert.equal(url.searchParams.get("team_id"), "team-a");
  assert.equal(url.searchParams.get("visibility"), "private");
});

test("cross-page search follows cursors and deduplicates overlapping records", async () => {
  const paths = [];
  const progress = [];
  const all = await loadResourcePages(
    operation("limit", "cursor"),
    async (path) => {
      paths.push(path);
      return paths.length === 1
        ? { data: [{ id: "a" }, { id: "b" }], nextCursor: "second" }
        : {
            data: [
              { id: "b" },
              {
                id: "c",
                description: "target beyond the first page",
                tags: [{ id: "tag-id", label: "Production" }],
              },
            ],
          };
    },
    { onProgress: (count) => progress.push(count) },
  );
  assert.deepEqual(progress, [2, 3]);
  assert.deepEqual(
    all.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.match(paths[1], /cursor=second/);
  assert.deepEqual(
    all
      .filter((item) => matchesResource(item, { search: " PRODUCTION " }))
      .map((item) => item.id),
    ["c"],
  );
  assert.deepEqual(
    all
      .filter((item) => matchesResource(item, { search: "tag-id" }))
      .map((item) => item.id),
    ["c"],
  );
  assert.equal(
    all.filter((item) => matchesResource(item, { search: "TARGET" }))[0].id,
    "c",
  );
});

test("tags normalize labels and ids without searching arbitrary object data", () => {
  const tags = [
    " alpha ",
    "alpha",
    { id: "hidden-id", label: "Beta" },
    { id: "fallback" },
    null,
    {},
    5,
    { secret: "not-a-tag" },
  ];
  assert.deepEqual(resourceTags(tags), ["alpha", "Beta", "fallback"]);
  assert.equal(matchesResource({ tags }, { search: "HIDDEN-ID" }), true);
  assert.equal(matchesResource({ tags }, { search: "not-a-tag" }), false);
  assert.equal(matchesResource({}, { search: "beta" }), false);
  assert.deepEqual(resourceTags(null), []);
  assert.deepEqual(resourceTags([{ label: " ", id: " fallback " }]), [
    "fallback",
  ]);
});

test("cross-page loading supports offset, skip and page responses", async () => {
  for (const parameter of ["offset", "skip", "page"]) {
    const seen = [];
    const all = await loadResourcePages(
      operation(parameter, "limit", "page_size"),
      async (path) => {
        const page = seen.length;
        seen.push(new URL(path, "http://panel").searchParams.get(parameter));
        return {
          items: Array.from({ length: page === 0 ? 100 : 3 }, (_, i) => ({
            id: page * 100 + i,
          })),
          total: 103,
        };
      },
    );
    assert.equal(all.length, 103);
    assert.deepEqual(seen, parameter === "page" ? ["1", "2"] : ["0", "100"]);
  }
});

test("search rejects partial scans, repeated cursors, no progress and excessive results", async () => {
  await assert.rejects(
    loadResourcePages(operation("cursor"), async () => ({
      items: [{ id: "a" }],
      next_cursor: "same",
    })),
    /no progress/,
  );
  let page = 0;
  await assert.rejects(
    loadResourcePages(operation("cursor"), async () => ({
      items: [{ id: ++page }],
      next_cursor: "same",
    })),
    /Repeated pagination cursor/,
  );
  await assert.rejects(
    loadResourcePages(operation(), async () => ({
      items: [{ id: "a" }],
      total: 2,
    })),
    /Incomplete pagination/,
  );
  await assert.rejects(
    loadResourcePages(operation(), async () => [{ id: "a" }, { id: "b" }], {
      maxItems: 1,
    }),
    /Search limit exceeded/,
  );
  let requests = 0;
  await assert.rejects(
    loadResourcePages(operation("cursor"), async () => {
      if (requests++) throw new Error("backend denied next page");
      return { items: [{ id: "a" }], next_cursor: "next" };
    }),
    /backend denied next page/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadResourcePages(
      operation(),
      async () => assert.fail("aborted scan fetched data"),
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
});

test("search combines text, state, visibility and team without treating unknown states as enabled", () => {
  const item = {
    id: "a",
    name: "My server",
    description: "Needle",
    enabled: false,
    visibility: "team",
    teamId: "team-a",
  };
  assert.equal(
    matchesResource(item, {
      search: "  NEEDLE ",
      state: "disabled",
      visibility: "team",
      team: "team-a",
    }),
    true,
  );
  for (const filter of [
    { state: "enabled" },
    { visibility: "public" },
    { team: "team-b" },
  ])
    assert.equal(matchesResource(item, filter), false);
  assert.equal(matchesResource({ id: "unknown" }, { state: "enabled" }), false);
  assert.equal(
    matchesResource(
      { name: "plugin", status: "enabled" },
      { state: "enabled" },
    ),
    true,
  );
  assert.equal(
    matchesResource(
      { name: "plugin", status: "disabled" },
      { state: "disabled" },
    ),
    true,
  );
});

test("revoked tokens are excluded from enabled state filtering", () => {
  const revoked = { id: "fake-token", is_active: true, is_revoked: true };
  assert.equal(resourceStatus(revoked), false);
  assert.equal(matchesResource(revoked, { state: "enabled" }), false);
  assert.equal(matchesResource(revoked, { state: "disabled" }), true);
});

test("duration formatting preserves zero and missing samples without floating-point noise", () => {
  assert.equal(formatDuration(52.519000000000005), "52.52 ms");
  assert.equal(formatDuration(0), "0 ms");
  assert.equal(formatDuration(0.001), "<0.01 ms");
  for (const missing of [null, undefined, "", false, NaN, Infinity, -1])
    assert.equal(formatDuration(missing), "—");
  assert.equal(formatOperationalValue(0.3333333333, "error_rate"), "0.33%");
});

test("backend naive UTC and explicit offsets display consistently with timezone and DST", () => {
  const utc = formatTimestamp(
    "2026-10-16T10:00:00.123456",
    true,
    "Europe/Berlin",
  );
  assert.equal(
    utc,
    formatTimestamp("2026-10-16T10:00:00.123456+00:00", true, "Europe/Berlin"),
  );
  assert.match(utc, /12:00:00 GMT\+2/);
  assert.match(
    formatTimestamp("2026-01-16T10:00:00Z", true, "Europe/Berlin"),
    /11:00:00 GMT\+1/,
  );
  assert.equal(formatTimestamp("invalid"), "—");
});

test("aligned metric arrays map counts and latency while preserving absent buckets", () => {
  const buckets = ["2026-10-16T10:00:00Z", "2026-10-16T11:00:00Z"];
  assert.deepEqual(
    metricRows(
      { buckets, values: [12, 0], success_count: [10, 0], error_count: [2, 0] },
      "timeseries",
    )[0],
    {
      timestamp: buckets[0],
      request_count: 12,
      success_count: 10,
      error_count: 2,
    },
  );
  assert.deepEqual(
    metricRows(
      { buckets, p50: [0, null], p95: [10], p99: [20] },
      "percentiles",
    ),
    [
      { timestamp: buckets[0], p50: 0, p95: 10, p99: 20 },
      { timestamp: buckets[1], p50: null, p95: null, p99: null },
    ],
  );
});
