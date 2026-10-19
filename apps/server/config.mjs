import { trustedProxies } from "./client-ip.mjs";
import { normalizeLogLevel } from "./logger.mjs";
export function normalizePrefix(value = "") {
  if (!value || value === "/") return "";
  if (
    !/^\/[a-zA-Z0-9_/-]+$/.test(value) ||
    value.includes("//") ||
    value.split("/").includes("..")
  )
    throw new Error(
      "APP_ROOT_PATH must be an absolute URL path without query or traversal",
    );
  return value.replace(/\/+$/, "");
}
export function readConfig(env = process.env) {
  const prefix = normalizePrefix(env.APP_ROOT_PATH);
  const upstream = new URL(env.BACKEND_URL || "http://127.0.0.1:4444");
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash
  )
    throw new Error("BACKEND_URL must be an HTTP origin with an optional path");
  const publicOrigin = new URL(
    env.PUBLIC_ORIGIN || `http://localhost:${env.PORT || 3000}`,
  ).origin;
  return {
    prefix,
    trustedProxies: trustedProxies(env.TRUSTED_PROXY_CIDRS),
    upstream,
    publicOrigin,
    secure: env.COOKIE_SECURE === "true",
    port: Number(env.PORT || 3000),
    host: env.HOST || "0.0.0.0",
    logLevel: normalizeLogLevel(env.LOG_LEVEL),
  };
}
export function upstreamPath(config, path) {
  return config.upstream.pathname.replace(/\/$/, "") + path;
}
