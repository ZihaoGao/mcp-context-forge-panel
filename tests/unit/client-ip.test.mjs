import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedProxies, clientIp } from "../../apps/server/client-ip.mjs";
const req = (peer, forwarded) => ({
  socket: { remoteAddress: peer },
  headers: { "x-forwarded-for": forwarded },
});
test("ignores spoofed forwarding headers on direct connections", () => {
  assert.equal(
    clientIp(req("203.0.113.9", "198.51.100.1"), trustedProxies()),
    "203.0.113.9",
  );
});
test("walks trusted proxies from right to left and stops at the real client", () => {
  const trust = trustedProxies("127.0.0.0/8,10.0.0.0/8");
  assert.equal(
    clientIp(
      req("::ffff:127.0.0.1", "198.51.100.1, 203.0.113.9, 10.0.0.4"),
      trust,
    ),
    "203.0.113.9",
  );
  assert.equal(clientIp(req("127.0.0.1", "bad-value"), trust), "127.0.0.1");
});
test("accepts explicitly trusted IPv6 peers and rejects invalid CIDRs", () => {
  assert.equal(
    clientIp(req("::1", "2001:db8::7"), trustedProxies("::1/128")),
    "2001:db8::7",
  );
  assert.throws(() => trustedProxies("not-an-ip"));
});
