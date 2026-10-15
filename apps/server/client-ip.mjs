import { BlockList, isIP } from "node:net";
function normalized(ip) {
  return ip?.startsWith("::ffff:") && isIP(ip.slice(7)) === 4
    ? ip.slice(7)
    : ip;
}
export function trustedProxies(value = "") {
  const list = new BlockList();
  for (const entry of value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)) {
    const [address, prefix] = entry.split("/");
    const version = isIP(address);
    if (!version) throw new Error("Invalid TRUSTED_PROXY_CIDRS address");
    list.addSubnet(
      address,
      prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix),
      version === 4 ? "ipv4" : "ipv6",
    );
  }
  return list;
}
export function clientIp(request, allowlist) {
  const peer = normalized(request.socket.remoteAddress) || "127.0.0.1";
  const trusted = (ip) =>
    allowlist?.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
  if (!trusted(peer)) return peer;
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")
    .map((v) => normalized(v.trim()));
  if (!forwarded.length || forwarded.some((ip) => !isIP(ip))) return peer;
  const chain = [...forwarded, peer];
  let index = chain.length - 1;
  while (index > 0 && trusted(chain[index])) index--;
  return chain[index];
}
