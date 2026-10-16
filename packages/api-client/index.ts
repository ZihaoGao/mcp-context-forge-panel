import type { components } from "./schema";
export type UserProfile = components["schemas"]["EmailUserResponse"];
export type TokenCreateRequest = components["schemas"]["TokenCreateRequest"];
export type TokenCreateResponse = components["schemas"]["TokenCreateResponse"];
export type JsonRecord = Record<string, any>;
declare global {
  interface Window {
    __PANEL_CONFIG__: {
      prefix: string;
      version: string;
      publicOrigin?: string;
    };
  }
}
export const config = window.__PANEL_CONFIG__ || {
  prefix: "",
  version: "1.0.11",
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(
      `${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`,
    );
  }
}
export async function request<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("API path must be local");
  const headers = new Headers(options.headers);
  headers.set("X-Panel-Request", "1");
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  const response = await fetch(config.prefix + path, {
    ...options,
    headers,
    credentials: "same-origin",
    redirect: "error",
  });
  const mime = response.headers.get("Content-Type") || "";
  if (response.ok && mime && !/json|text\/|xml|javascript/.test(mime))
    return {
      download: await response.blob(),
      filename:
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="?([^";]+)/)?.[1] || "contextforge-download",
    } as T;
  const text = await response.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* retain non-JSON response for diagnostics */
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/_panel/") &&
      !headers.has("Authorization")
    )
      window.dispatchEvent(new Event("panel:unauthorized"));
    throw new ApiError(
      response.status,
      data?.detail || data || response.statusText,
    );
  }
  return data;
}
export const send = (path: string, method: string, body?: unknown) =>
  request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export function displayError(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.detail &&
      typeof error.detail === "object" &&
      "code" in error.detail &&
      error.detail.code === "ORIGIN_MISMATCH"
    )
      return "访问地址与部署配置不一致，请使用登录页给出的正确入口重新登录。";
    if (Array.isArray(error.detail))
      return error.detail
        .map(
          (v) =>
            `${v.loc?.filter((p: string) => p !== "body").join(".") || "输入"}：${v.msg || JSON.stringify(v)}`,
        )
        .join("；");
    const explanation: Record<number, string> = {
      401: "登录凭据无效或会话已过期，请检查邮箱、密码或 Token 后重新登录",
      400: "请求未通过后端检查",
      403: "当前账户没有权限，或资源不属于当前团队",
      409: "资源已存在或配置冲突",
      422: "输入不符合后端规则",
      429: "请求过于频繁，请稍后重试",
      503: "后端或上游服务暂时不可用",
    };
    return `${explanation[error.status] || "请求失败"}（${error.status}）：${typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
export function permitted(permissions: string[], permission?: string): boolean {
  return (
    !permission ||
    permissions.includes("*") ||
    permissions.includes(permission) ||
    permissions.includes(permission.split(".")[0] + ".*")
  );
}
