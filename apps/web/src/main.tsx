import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Braces,
  ChevronDown,
  CircleHelp,
  Command,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import baseline from "../../../contracts/contextforge/auth-contract.json";
import {
  operations,
  listItems,
  mergeContracts,
} from "../../../packages/api-client/contract.mjs";
import {
  config,
  request,
  send,
  displayError,
  permitted,
  type JsonRecord,
  type UserProfile,
} from "../../../packages/api-client";
import { modules } from "./modules";
import { DataPage, findOperation } from "./components/DataPage";
import { ApiExplorer } from "./components/ApiExplorer";
import { RbacPanel } from "./components/RbacPanel";
import { Chat } from "./components/Chat";
import { Connections } from "./components/Connections";
import { ActionDialog, type Operation } from "./components/ActionDialog";
import "./style.css";
import { SessionContext } from "./session";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 20000 },
  },
});
function useRoute() {
  const readRoute = () =>
    window.location.hash.slice(1) ||
    window.location.pathname
      .slice((config.prefix + "/app/").length)
      .replace(/\/$/, "") ||
    "dashboard";
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}
function Login({
  onLogin,
  en,
  setEn,
  route,
}: {
  onLogin: () => void;
  en: boolean;
  setEn: (value: boolean) => void;
  route: string;
}) {
  const [tokenMode, setTokenMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState(
    route === "sso-error"
      ? "SSO 登录未完成 / SSO sign-in did not complete"
      : "",
  );
  const [busy, setBusy] = useState(false);
  const canonicalLogin =
    config.publicOrigin && config.publicOrigin !== window.location.origin
      ? `${config.publicOrigin}${config.prefix}/app/`
      : "";
  const [action, setAction] = useState<Operation | undefined>(() =>
    route.startsWith("reset-password/")
      ? findOperation(baseline, "/v1/auth/email/reset-password/{token}", "POST")
      : route === "forgot-password"
        ? findOperation(baseline, "/v1/auth/email/forgot-password", "POST")
        : route === "register"
          ? findOperation(baseline, "/v1/auth/email/register", "POST")
          : undefined,
  );
  const providers = useQuery({
    queryKey: ["sso-providers"],
    queryFn: () => request("/v1/auth/sso/providers"),
    retry: false,
  });
  async function sso(provider: string) {
    setBusy(true);
    setError("");
    try {
      const callback =
        window.location.origin +
        config.prefix +
        "/v1/auth/sso/callback/" +
        encodeURIComponent(provider);
      const result = await request(
        "/v1/auth/sso/login/" +
          encodeURIComponent(provider) +
          "?redirect_uri=" +
          encodeURIComponent(callback),
      );
      const target = new URL(result.authorization_url || result.auth_url);
      if (!["http:", "https:"].includes(target.protocol))
        throw new Error("Invalid SSO URL");
      window.location.assign(target.href);
    } catch (err) {
      setError(displayError(err));
      setBusy(false);
    }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await send(
        tokenMode ? "/_panel/token-login" : "/_panel/login",
        "POST",
        tokenMode ? { token } : { email, password },
      );
      setPassword("");
      setToken("");
      onLogin();
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <aside className="login-story">
        <a className="brand" href="#dashboard">
          <span className="brand-mark">
            <Boxes size={25} />
          </span>
          <div>
            ContextForge<small>CONTROL PLANE</small>
          </div>
        </a>
        <div className="login-story-body">
          <span className="eyebrow">YOUR TOOLS. CONNECTED.</span>
          <h1>
            {en ? (
              <>
                A shared home for
                <br />
                your AI infrastructure.
              </>
            ) : (
              <>
                连接工具，
                <br />
                让智能协作有序发生。
              </>
            )}
          </h1>
          <p>
            {en
              ? "Discover MCP services, manage access, and bring your models and tools together."
              : "从 MCP 服务接入到权限治理，在一个工作空间中管理模型、工具与团队。"}
          </p>
          <div className="login-network">
            <span>
              <Boxes size={24} />
              MCP
            </span>
            <i />
            <span>
              <Sparkles size={24} />
              LLM
            </span>
            <i />
            <span>
              <ShieldCheck size={24} />
              RBAC
            </span>
          </div>
        </div>
        <small>ContextForge backend v{config.version}</small>
      </aside>
      <main className="login-main">
        <button className="language-button" onClick={() => setEn(!en)}>
          <Globe size={16} />
          {en ? "中文" : "English"}
        </button>
        <form className="login-form" onSubmit={login}>
          <span className="eyebrow">CONTEXTFORGE CONSOLE</span>
          <h2>{en ? "Welcome back" : "欢迎回来"}</h2>
          <p className="muted">
            {en
              ? "Sign in to your workspace to continue."
              : "登录工作空间，开始管理你的工具与服务。"}
          </p>
          {route.startsWith("accept-invitation/") && (
            <div className="alert info">
              {en
                ? "Sign in with the invited email to accept the team invitation."
                : "请使用受邀邮箱登录，然后接受团队邀请。"}
            </div>
          )}
          {canonicalLogin && (
            <div className="alert warning" role="alert">
              <p>
                {en
                  ? "This address differs from the configured public origin. Sign in using the configured entry:"
                  : "当前访问地址与部署配置不一致，请使用正确入口登录："}
              </p>
              <a href={canonicalLogin}>{canonicalLogin}</a>
            </div>
          )}
          <div className="segmented login-method">
            <button
              type="button"
              className={!tokenMode ? "active" : ""}
              onClick={() => setTokenMode(false)}
            >
              {en ? "Email & password" : "邮箱密码"}
            </button>
            <button
              type="button"
              className={tokenMode ? "active" : ""}
              onClick={() => setTokenMode(true)}
            >
              {en ? "Existing token" : "已有 Token"}
            </button>
          </div>
          {tokenMode ? (
            <>
              <label className="field">
                Token
                <textarea
                  required
                  rows={4}
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <small className="muted">
                {en
                  ? "API tokens cannot create or manage other keys. Use an interactive login for key management."
                  : "API Token 无法创建或管理其他 Key，管理 Key 请使用邮箱登录。"}
              </small>
            </>
          ) : (
            <>
              <label className="field">
                {en ? "Email address" : "邮箱地址"}
                <input
                  required
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="field">
                {en ? "Password" : "密码"}
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  placeholder={en ? "Your password" : "请输入密码"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          <button className="button primary login-submit" disabled={busy}>
            {busy ? (en ? "Signing in…" : "登录中…") : en ? "Sign in" : "登录"}
            <ArrowRight size={17} />
          </button>
          <div className="login-links">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setAction(
                  findOperation(
                    baseline,
                    "/v1/auth/email/forgot-password",
                    "POST",
                  ),
                )
              }
            >
              {en ? "Forgot password?" : "忘记密码"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setAction(
                  findOperation(baseline, "/v1/auth/email/register", "POST"),
                )
              }
            >
              {en ? "Create account" : "注册账户"}
            </button>
          </div>
          {listItems(providers.data).length > 0 && (
            <div className="sso-options">
              <p className="muted">
                {en ? "Or continue with SSO" : "或通过组织账户登录"}
              </p>
              {listItems(providers.data).map((provider: JsonRecord) => (
                <button
                  type="button"
                  className="button secondary"
                  key={provider.id}
                  disabled={busy}
                  onClick={() => sso(provider.id)}
                >
                  {provider.name || provider.id}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          )}
        </form>
        <footer>
          {en
            ? "Access is governed by your organization’s permissions."
            : "资源与操作权限由所属组织统一管理。"}
        </footer>
      </main>
      {action && (
        <ActionDialog
          operation={action}
          preset={
            route.startsWith("reset-password/")
              ? { token: decodeURIComponent(route.split("/")[1]) }
              : {}
          }
          spec={baseline}
          onClose={() => setAction(undefined)}
          onSuccess={() => {}}
          en={en}
        />
      )}
    </div>
  );
}

function Dashboard({
  user,
  permissions,
  team,
  en,
}: {
  user: JsonRecord;
  permissions: string[];
  team: string;
  en: boolean;
}) {
  const counts = useQuery({
    queryKey: ["overview", team, permissions],
    queryFn: async () =>
      Promise.all(
        modules
          .filter((m) =>
            ["servers", "gateways", "tools", "tokens"].includes(m.id),
          )
          .map(async (m) => {
            if (!permitted(permissions, `${m.permission}.read`))
              return { ...m, count: "—" };
            try {
              const data = await request(
                `${m.path}${m.id === "tokens" ? "?limit=100&include_inactive=true" : "?include_pagination=true&limit=100&include_inactive=true" + (team ? "&team_id=" + encodeURIComponent(team) : "")}`,
              );
              const items = listItems(data);
              return {
                ...m,
                count:
                  data.total ?? `${items.length}${data.nextCursor ? "+" : ""}`,
              };
            } catch {
              return { ...m, count: "—" };
            }
          }),
      ),
    retry: false,
  });
  return (
    <>
      <section className="welcome-panel">
        <div>
          <span className="eyebrow">WORKSPACE OVERVIEW</span>
          <h2>
            {en
              ? `Hello, ${user.full_name || user.email?.split("@")[0]}`
              : `你好，${user.full_name || user.email?.split("@")[0]}`}
          </h2>
          <p>
            {en
              ? "Your models, tools and access — all in one workspace."
              : "在同一个工作空间里，连接模型、管理工具、掌握访问权限。"}
          </p>
          <a className="button primary" href="#tokens">
            <KeyRound size={16} />
            {en ? "Manage API keys" : "管理我的 API Key"}
            <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="welcome-graphic" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="center-node">
            <Boxes size={40} />
          </div>
          <span className="node node-a">
            <Braces size={20} />
          </span>
          <span className="node node-b">
            <ShieldCheck size={20} />
          </span>
          <span className="node node-c">
            <Sparkles size={20} />
          </span>
        </div>
      </section>
      <div className="stat-grid">
        {(
          counts.data ||
          modules
            .filter((m) =>
              ["servers", "gateways", "tools", "tokens"].includes(m.id),
            )
            .map((m) => ({ ...m, count: "…" }))
        ).map((m) => (
          <a key={m.id} className="stat-card" href={"#" + m.id}>
            <div>
              <span>{en ? m.en : m.zh}</span>
              <m.icon size={19} />
            </div>
            <strong>{m.count}</strong>
            <small>
              {en ? "View resources" : "查看资源"}
              <ArrowUpRight size={13} />
            </small>
          </a>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="section-heading">
            <h3>{en ? "Start building" : "开始使用"}</h3>
            <span className="muted">
              {en ? "Your next connection" : "连接你的下一个服务"}
            </span>
          </div>
          {[
            {
              id: "gateways",
              zh: "接入 MCP 服务",
              en: "Connect an MCP service",
              sub: en
                ? "Register an upstream and discover tools"
                : "注册上游网关，发现并同步可用工具",
              icon: Boxes,
            },
            {
              id: "servers",
              zh: "组合虚拟服务器",
              en: "Compose a virtual server",
              sub: en
                ? "Give clients a curated set of capabilities"
                : "组合工具、资源和提示词，提供统一连接入口",
              icon: Command,
            },
            {
              id: "tokens",
              zh: "创建应用访问凭据",
              en: "Create application credentials",
              sub: en
                ? "Scope access to the resources you need"
                : "为应用分配必要权限，并设置有效期",
              icon: KeyRound,
            },
          ].map((step, i) => (
            <a className="getting-started" href={"#" + step.id} key={step.id}>
              <span className="step-number">0{i + 1}</span>
              <div>
                <strong>{en ? step.en : step.zh}</strong>
                <p>{step.sub}</p>
              </div>
              <ArrowRight size={17} />
            </a>
          ))}
        </section>
        <section className="panel access-summary">
          <div className="section-heading">
            <h3>{en ? "Your access" : "我的访问权限"}</h3>
            <ShieldCheck size={19} />
          </div>
          <span className="avatar large">
            {(user.full_name || user.email || "U")[0].toUpperCase()}
          </span>
          <h3>{user.full_name || user.email}</h3>
          <p className="muted">{user.email}</p>
          <span className="badge success">
            {user.is_admin
              ? en
                ? "Platform administrator"
                : "平台管理员"
              : en
                ? "Workspace member"
                : "工作空间成员"}
          </span>
          <div className="access-permissions">
            {permissions.slice(0, 5).map((p) => (
              <code key={p}>{p}</code>
            ))}
            {permissions.length > 5 && (
              <small>
                +{permissions.length - 5} {en ? "permissions" : "项权限"}
              </small>
            )}
          </div>
          <a className="text-button" href="#profile">
            {en ? "View profile & permissions" : "查看账户与有效权限"}
            <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
    </>
  );
}

function App() {
  const fullRoute = useRoute();
  const [route, routeQuery = ""] = fullRoute.split("?");
  const [en, setEn] = useState(localStorage.getItem("panel-language") === "en");
  const [team, setTeam] = useState("");
  const [mobile, setMobile] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [unauthorized, setUnauthorized] = useState(false);
  const [action, setAction] = useState<Operation>();
  const session = useQuery({
    queryKey: ["session", sessionVersion],
    queryFn: () => request<UserProfile>("/v1/auth/email/me"),
    retry: false,
  });
  const authenticated = !!session.data && !unauthorized;
  const permissionQuery = useQuery({
    queryKey: ["my-permissions", team, sessionVersion],
    queryFn: () =>
      request<string[]>(
        "/v1/rbac/my/permissions" +
          (team ? "?team_id=" + encodeURIComponent(team) : ""),
      ),
    enabled: authenticated,
    retry: false,
  });
  const permissions = permissionQuery.data || [];
  const teams = useQuery({
    queryKey: ["my-teams", sessionVersion],
    queryFn: () => request("/v1/teams/"),
    enabled: authenticated,
    retry: false,
  });
  const liveSpec = useQuery({
    queryKey: ["live-spec", sessionVersion],
    queryFn: () => request("/openapi.json"),
    enabled: authenticated,
    staleTime: Infinity,
  });
  const capturedSpec = useQuery({
    queryKey: ["captured-spec"],
    queryFn: () => request("/app/contract.json"),
    enabled: authenticated,
    staleTime: Infinity,
  });
  const spec = useMemo(
    () => mergeContracts(capturedSpec.data || baseline, liveSpec.data),
    [capturedSpec.data, liveSpec.data],
  );
  useEffect(() => {
    localStorage.setItem("panel-language", en ? "en" : "zh");
    document.documentElement.lang = en ? "en" : "zh-CN";
  }, [en]);
  useEffect(() => {
    const handler = () => setUnauthorized(true);
    window.addEventListener("panel:unauthorized", handler);
    return () => window.removeEventListener("panel:unauthorized", handler);
  }, []);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [route]);
  async function logout() {
    try {
      await send("/_panel/logout", "POST");
    } finally {
      setTeam("");
      client.clear();
      setUnauthorized(true);
    }
  }
  if (session.isPending && !unauthorized)
    return (
      <div className="boot-screen">
        <Boxes size={34} />
        <span>ContextForge Console</span>
      </div>
    );
  if (!authenticated)
    return (
      <Login
        en={en}
        setEn={setEn}
        route={route}
        onLogin={() => {
          client.clear();
          setUnauthorized(false);
          setSessionVersion((v) => v + 1);
        }}
      />
    );
  const module = modules.find((m) => m.id === route);
  const navVisible = (m: (typeof modules)[number]) =>
    m.anyPermissions
      ? m.anyPermissions.some((p) => permitted(permissions, p))
      : !m.permission ||
        permitted(
          permissions,
          m.permission.includes(".") ? m.permission : m.permission + ".read",
        );
  const navGroups = [
    { id: "workspace", zh: "工作空间", en: "WORKSPACE" },
    { id: "resources", zh: "资源管理", en: "RESOURCES" },
    { id: "access", zh: "身份与权限", en: "ACCESS CONTROL" },
    { id: "governance", zh: "治理与运维", en: "GOVERNANCE" },
  ];
  const title = module
    ? en
      ? module.en
      : module.zh
    : {
        dashboard: en ? "Workspace overview" : "工作台",
        api: en ? "API workspace" : "接口工作台",
        chat: en ? "LLM playground" : "对话调试",
        profile: en ? "My account" : "我的账户",
      }[route] || (en ? "Page not found" : "页面不存在");
  return (
    <SessionContext.Provider
      value={{ user: session.data, permissions, team, en }}
    >
      <div className="app-shell">
        <div
          className={`sidebar-backdrop ${mobile ? "visible" : ""}`}
          onClick={() => setMobile(false)}
        />
        <aside className={`sidebar ${mobile ? "open" : ""}`}>
          <a className="brand" href="#dashboard">
            <span className="brand-mark">
              <Boxes size={23} />
            </span>
            <div>
              ContextForge<small>CONSOLE</small>
            </div>
          </a>
          <div className="workspace-picker">
            <span className="workspace-icon">C</span>
            <div>
              <strong>{en ? "My workspace" : "我的工作空间"}</strong>
              <small>ContextForge v{config.version}</small>
            </div>
            <ChevronDown size={15} />
          </div>
          <nav>
            <a
              className={`nav-link ${route === "dashboard" ? "active" : ""}`}
              href="#dashboard"
            >
              <LayoutDashboard size={18} />
              {en ? "Overview" : "工作台"}
            </a>
            {navGroups.map((group) => (
              <div className="nav-group" key={group.id}>
                <div className="nav-label">{en ? group.en : group.zh}</div>
                {modules
                  .filter((m) => m.group === group.id && navVisible(m))
                  .map((m) => (
                    <a
                      key={m.id}
                      className={`nav-link ${route === m.id ? "active" : ""}`}
                      href={"#" + m.id}
                    >
                      <m.icon size={18} />
                      {en ? m.en : m.zh}
                      {m.id === "tokens" && (
                        <span className="nav-accent">KEY</span>
                      )}
                    </a>
                  ))}
                {group.id === "workspace" &&
                  permitted(permissions, "llm.invoke") && (
                    <a
                      className={`nav-link ${route === "chat" ? "active" : ""}`}
                      href="#chat"
                    >
                      <Sparkles size={18} />
                      {en ? "Playground" : "对话调试"}
                    </a>
                  )}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <a
              href="#api"
              className={`nav-link ${route === "api" ? "active" : ""}`}
            >
              <Braces size={18} />
              {en ? "API workspace" : "接口工作台"}
              <ArrowUpRight size={14} />
            </a>
            <a href="#connections" className="nav-link">
              <CircleHelp size={18} />
              {en ? "Connection guide" : "连接与使用指南"}
            </a>
            <div className="sidebar-version">
              <span className="status-dot" />
              Independent console <span>0.1.0</span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="icon-button mobile-toggle"
                aria-label="Open navigation"
                onClick={() => setMobile(!mobile)}
              >
                <Menu size={20} />
              </button>
              <span>Console</span>
              <span>/</span>
              <strong>{title}</strong>
            </div>
            <div className="topbar-actions">
              <select
                aria-label="Team context"
                className="team-select"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="">
                  {en ? "All accessible teams" : "所有可访问团队"}
                </option>
                {listItems(teams.data).map((t: JsonRecord) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                aria-label="Change language"
                title={en ? "中文" : "English"}
                onClick={() => setEn(!en)}
              >
                <Globe size={18} />
              </button>
              <a className="avatar" title={session.data.email} href="#profile">
                {(session.data.full_name ||
                  session.data.email ||
                  "U")[0].toUpperCase()}
              </a>
            </div>
          </header>
          <main className="main-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {route === "dashboard"
                    ? "CONTROL PLANE"
                    : module?.group === "access"
                      ? "ACCESS & IDENTITY"
                      : "CONTEXTFORGE WORKSPACE"}
                </div>
                <h1>{title}</h1>
                <p>
                  {module
                    ? en
                      ? `Manage ${module.en.toLowerCase()} and related actions.`
                      : module.subtitle
                    : route === "api"
                      ? en
                        ? "Explore and execute backend capabilities from the live API contract."
                        : "依据接口契约查询和执行后端业务能力。"
                      : route === "dashboard"
                        ? en
                          ? "Everything you need to connect and govern your AI tools."
                          : "连接与管理 AI 工具所需的一切。"
                        : route === "profile"
                          ? session.data.email
                          : en
                            ? "Connect, test, and inspect your services."
                            : "连接、测试并检查你的服务。"}
                </p>
              </div>
              <span className="badge neutral backend-badge">
                Backend {spec.info?.version || config.version}
              </span>
            </div>
            {permissionQuery.error && (
              <div className="alert error">
                {en
                  ? "Could not load effective permissions: "
                  : "无法读取有效权限："}
                {displayError(permissionQuery.error)}
              </div>
            )}
            {liveSpec.error && (
              <div className="alert warning">
                {en
                  ? "Live contract unavailable; showing the captured v1.0.11 contract. Feature availability may differ."
                  : "实时接口规范不可用，暂用 v1.0.11 快照；实际功能可能因后端配置不同而变化。"}
              </div>
            )}
            {route.startsWith("accept-invitation/") ? (
              <section className="panel prose">
                <h3>{en ? "Accept team invitation" : "接受团队邀请"}</h3>
                <p className="muted">
                  {en
                    ? "Confirm the invitation using your signed-in account."
                    : "请确认使用当前登录账户接受邀请。"}
                </p>
                {findOperation(
                  spec,
                  "/v1/teams/invitations/{token}/accept",
                  "POST",
                ) && (
                  <ActionDialog
                    operation={findOperation(
                      spec,
                      "/v1/teams/invitations/{token}/accept",
                      "POST",
                    )!}
                    spec={spec}
                    preset={{ token: decodeURIComponent(route.split("/")[1]) }}
                    onClose={() => {
                      window.location.hash = "teams";
                    }}
                    onSuccess={() => {
                      void client.invalidateQueries({ queryKey: ["my-teams"] });
                    }}
                    en={en}
                  />
                )}
              </section>
            ) : route === "dashboard" ? (
              <Dashboard
                user={session.data}
                permissions={permissions}
                team={team}
                en={en}
              />
            ) : route === "api" ? (
              <ApiExplorer spec={spec} en={en} />
            ) : route === "chat" ? (
              <Chat en={en} />
            ) : route === "connections" ? (
              <Connections liveSpec={liveSpec.data} />
            ) : route === "profile" ? (
              <>
                <section className="panel prose">
                  <div className="section-heading">
                    <h3>
                      {en
                        ? "Account & effective permissions"
                        : "账户与有效权限"}
                    </h3>
                    <button className="button secondary" onClick={logout}>
                      <LogOut size={16} />
                      {en ? "Sign out" : "退出登录"}
                    </button>
                  </div>
                  <p>
                    {session.data.full_name} · {session.data.email}
                  </p>
                  <div className="permission-chips">
                    {permissions.map((p) => (
                      <code key={p}>{p}</code>
                    ))}
                  </div>
                  <button
                    className="button secondary"
                    onClick={() =>
                      setAction(
                        findOperation(
                          spec,
                          "/v1/auth/email/change-password",
                          "POST",
                        ),
                      )
                    }
                  >
                    {en ? "Change password" : "修改密码"}
                  </button>
                </section>
                <ApiExplorer spec={spec} filter="/v1/rbac/my/" en={en} />
              </>
            ) : module ? (
              <>
                {route === "rbac" && (
                  <RbacPanel spec={spec} team={team} en={en} />
                )}
                <DataPage
                  key={module.id}
                  routeQuery={routeQuery}
                  module={module}
                  spec={spec}
                  permissions={permissions}
                  team={team}
                  teams={listItems(teams.data)}
                  onTeamChange={setTeam}
                  en={en}
                />
                {route === "llm" && (
                  <section className="panel">
                    <div className="section-heading">
                      <h3>
                        {en ? "Models & proxy actions" : "模型与代理操作"}
                      </h3>
                      <a href="#chat" className="text-button">
                        {en ? "Open playground" : "打开对话调试"}
                        <ArrowUpRight size={15} />
                      </a>
                    </div>
                    <ApiExplorer spec={spec} filter="llm" en={en} />
                  </section>
                )}
              </>
            ) : (
              <div className="empty">
                <h2>404</h2>
                <a href="#dashboard">
                  {en ? "Return to workspace" : "返回工作台"}
                </a>
              </div>
            )}
            <footer className="content-footer">
              <span>ContextForge Console</span>
              <span>
                {en
                  ? "Permissions enforced by your backend"
                  : "操作权限由后端执行校验"}
              </span>
            </footer>
          </main>
        </div>
        {action && (
          <ActionDialog
            operation={action}
            spec={spec}
            onClose={() => setAction(undefined)}
            onSuccess={() => {}}
            en={en}
          />
        )}
      </div>
    </SessionContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
