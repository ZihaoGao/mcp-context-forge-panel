import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  config,
  request,
  displayError,
  type JsonRecord,
} from "../../../../packages/api-client";
import { listItems } from "../../../../packages/api-client/contract.mjs";
import { ReferenceInput } from "./ReferenceInput";
import { useText } from "../session";

const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";

function GeneratedConfig({
  text,
  ready,
  preview,
  check,
  note,
}: {
  text: string;
  ready: boolean;
  preview: string;
  check: () => Promise<string>;
  note: string;
}) {
  const t = useText();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="generated-config">
      {ready ? (
        <pre>{preview}</pre>
      ) : (
        <p className="alert info">
          {t(
            "请先完成选择并填写 API Key，再生成配置。已有 Key 无法找回明文，请从凭据管理器中粘贴，或创建新的 Key。",
            "Complete the selection and paste an API key to generate configuration. Existing keys cannot be recovered; paste one from your credential manager or create a new key.",
          )}
        </p>
      )}
      <div className="picker-actions">
        <button
          type="button"
          className="button primary"
          disabled={!ready}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setStatus(
                t(
                  "配置已复制（包含 API Key），请妥善保管。",
                  "Configuration copied, including the API key. Keep it secure.",
                ),
              );
            } catch {
              setStatus(
                t(
                  "剪贴板不可用，请在安全的浏览器环境中重试。",
                  "Clipboard unavailable. Try again in a secure browser context.",
                ),
              );
            }
          }}
        >
          {t("复制完整配置", "Copy configuration")}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setStatus("");
            try {
              setStatus(await check());
            } catch (err) {
              setStatus(displayError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("检查中…", "Checking…") : t("检查连接", "Check connection")}
        </button>
      </div>
      <p className="field-help">
        {t(
          "预览隐藏 Key；复制内容包含你填写的 Key。Key 仅保留在当前页面内存中。",
          "The preview hides your key; copied configuration includes it. Your key stays in this page's memory only. ",
        )}
        {note}
      </p>
      <p role="status">{status}</p>
      <a className="text-button" href="#tokens">
        {t("创建或管理 API Key", "Create or manage API keys")}
      </a>
    </div>
  );
}

export function McpConnection({ serverId = "" }: { serverId?: string }) {
  const t = useText();
  const [server, setServer] = useState(serverId);
  const [client, setClient] = useState("mcp");
  const [key, setKey] = useState("");
  const root = (config.publicOrigin || window.location.origin) + config.prefix;
  const path = `/servers/${encodeURIComponent(server)}/mcp`;
  const make = (secret: string) =>
    JSON.stringify(
      {
        [client === "vscode" ? "servers" : "mcpServers"]: {
          contextforge: {
            type: "http",
            url: root + path,
            headers: { Authorization: `Bearer ${secret}` },
          },
        },
      },
      null,
      2,
    );
  async function check() {
    const response = await fetch(config.prefix + path, {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${key.trim()}`,
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "contextforge-panel-check", version: "1.0" },
        },
      }),
    });
    const session = response.headers.get("Mcp-Session-Id");
    try {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          t(
            `MCP 握手失败（${response.status}），请检查 Key 范围、服务状态及后端日志。`,
            `MCP handshake failed (${response.status}). Check key scope, server status and backend logs.`,
          ),
        );
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      try {
        while (text.length < 65536) {
          const chunk = await reader.read();
          text += decoder.decode(chunk.value, { stream: !chunk.done });
          const candidates = response.headers
            .get("Content-Type")
            ?.includes("text/event-stream")
            ? text
                .split(/\r?\n\r?\n/)
                .slice(0, -1)
                .flatMap((event) =>
                  event
                    .split(/\r?\n/)
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trim()),
                )
            : [text];
          for (const candidate of candidates) {
            let message;
            try {
              message = JSON.parse(candidate);
            } catch {
              continue;
            }
            if (message.error)
              throw new Error(
                t(
                  "MCP 握手被拒绝，请检查服务权限及后端日志。",
                  "MCP handshake rejected. Check server permissions and backend logs.",
                ),
              );
            if (message.id === 1 && message.result?.protocolVersion)
              return t(
                `MCP 初始化握手成功（${message.result.protocolVersion}）。尚未执行工具或验证上游业务调用。`,
                `MCP initialization succeeded (${message.result.protocolVersion}). Tools and upstream calls have not been tested.`,
              );
          }
          if (chunk.done) break;
        }
        throw new Error(
          t(
            "未收到有效的 MCP 初始化响应。",
            "No valid MCP initialization response received.",
          ),
        );
      } finally {
        await reader.cancel().catch(() => {});
      }
    } finally {
      if (session)
        await fetch(config.prefix + path, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${key.trim()}`,
            "Mcp-Session-Id": session,
            "MCP-Protocol-Version": "2025-03-26",
          },
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
    }
  }
  return (
    <section className="panel prose">
      <h3>MCP · Streamable HTTP</h3>
      <div className="schema-form">
        <div className="field full">
          <span>{t("虚拟服务器", "Virtual server")}</span>
          <ReferenceInput
            name="server_id"
            value={server}
            required
            onChange={(v) => setServer(v || "")}
          />
        </div>
        <label className="field">
          <span>{t("客户端配置格式", "Client configuration format")}</span>
          <select
            aria-label={t("客户端配置格式", "Client configuration format")}
            value={client}
            onChange={(e) => setClient(e.target.value)}
          >
            <option value="mcp">
              {t(
                "通用 MCP JSON（mcpServers）",
                "Generic MCP JSON (mcpServers)",
              )}
            </option>
            <option value="vscode">VS Code（.vscode/mcp.json）</option>
          </select>
        </label>
        <label className="field">
          <span>MCP API Key</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      </div>
      <p className="field-help">
        {t(
          "先创建虚拟服务器并关联工具，再使用限制到该服务器的 Key。没有可选服务器时，请创建服务器或检查账户权限。",
          "Create a virtual server and associate tools, then use a key scoped to that server. If no servers are available, create one or check your account permissions. ",
        )}
        <a href="#servers">{t("管理虚拟服务器", "Manage virtual servers")}</a>
      </p>
      <GeneratedConfig
        key={`${server}:${client}:${key}`}
        ready={!!server && !!key.trim()}
        text={make(key.trim())}
        preview={make("••••••")}
        check={check}
        note={t(
          "连接检查只执行 MCP 初始化握手，不调用工具。",
          "Connection checks only perform MCP initialization; no tools are called.",
        )}
      />
    </section>
  );
}

export function Connections({ liveSpec }: { liveSpec?: JsonRecord }) {
  const t = useText();
  const discovered =
    Object.keys(liveSpec?.paths || {})
      .find((p) => p.endsWith("/chat/completions"))
      ?.replace(/\/chat\/completions$/, "") || "";
  const [manualPrefix, setManualPrefix] = useState<string>();
  const [model, setModel] = useState("");
  const [client, setClient] = useState("curl");
  const [key, setKey] = useState("");
  const prefix = manualPrefix ?? discovered;
  const validPrefix = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(prefix);
  const models = useQuery({
    queryKey: ["connection-models", prefix],
    queryFn: () => request(prefix + "/models"),
    enabled: validPrefix,
    retry: false,
  });
  const modelList = Array.isArray(models.data?.data)
    ? models.data.data
    : listItems(models.data);
  const root = (config.publicOrigin || window.location.origin) + config.prefix;
  const make = (secret: string) =>
    client === "curl"
      ? `curl ${quote(root + prefix + "/chat/completions")} \\\n  -H ${quote("Authorization: Bearer " + secret)} \\\n  -H 'Content-Type: application/json' \\\n  -d ${quote(JSON.stringify({ model, messages: [{ role: "user", content: "Hello" }], stream: true }))}`
      : `from openai import OpenAI\n\nclient = OpenAI(base_url=${JSON.stringify(root + prefix)}, api_key=${JSON.stringify(secret)})\nresponse = client.chat.completions.create(model=${JSON.stringify(model)}, messages=[{"role": "user", "content": "Hello"}])\nprint(response.choices[0].message.content)`;
  return (
    <div className="dashboard-columns">
      <McpConnection />
      <section className="panel prose">
        <h3>LLM · OpenAI compatible</h3>
        <p className="field-help">
          {discovered
            ? t(
                "API 前缀来自当前后端实时接口规范，可按管理员提供的配置修改。",
                "The API prefix comes from the live backend contract. Adjust it if your administrator provides a different configuration.",
              )
            : t(
                "无法从实时规范确定 API 前缀。请向管理员获取后端 LLM_API_PREFIX（例如 /llm/v1），不要填写供应商的地址。",
                "The live contract does not identify the API prefix. Ask your administrator for LLM_API_PREFIX (for example /llm/v1), rather than a provider URL.",
              )}
        </p>
        <div className="schema-form">
          <label className="field full">
            <span>{t("LLM API 前缀", "LLM API prefix")}</span>
            <input
              value={prefix}
              placeholder={t(
                "由管理员提供，例如 /llm/v1",
                "Ask your administrator, e.g. /llm/v1",
              )}
              onChange={(e) => {
                setManualPrefix(e.target.value);
                setModel("");
              }}
            />
          </label>
          <label className="field">
            <span>{t("模型", "Model")}</span>
            <input
              list="connection-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("选择或填写模型 ID", "Select or enter a model ID")}
            />
            <datalist id="connection-models">
              {modelList.map((m: JsonRecord) => (
                <option key={m.id || m.model_id} value={m.id || m.model_id}>
                  {m.name || m.model_name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>{t("LLM 客户端", "LLM client")}</span>
            <select
              aria-label={t("LLM 客户端", "LLM client")}
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="curl">curl（POSIX shell）</option>
              <option value="python">Python · OpenAI SDK</option>
            </select>
          </label>
          <label className="field full">
            <span>LLM API Key</span>
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
        </div>
        {prefix && !validPrefix && (
          <p className="error-text">
            {t(
              "前缀须是以 / 开头的本地路径，不能包含域名、查询参数或上级目录。",
              "Use a local path starting with /. Domains, queries and parent directories are not allowed.",
            )}
          </p>
        )}
        {models.error && (
          <p className="alert warning">
            {t("模型列表不可用：", "Model list unavailable: ")}
            {displayError(models.error)}。
            {t(
              "请确认 LLM 功能已开启、前缀和权限正确，或向管理员获取可用模型 ID。",
              "Check that LLM is enabled and the prefix and permissions are correct, or ask your administrator for a model ID.",
            )}
          </p>
        )}
        {models.isSuccess && !modelList.length && (
          <p className="alert info">
            {t(
              "尚无可用模型。请配置模型与供应商，或向管理员获取模型 ID。",
              "No models available. Configure a provider and models, or ask your administrator for a model ID. ",
            )}
            <a href="#llm">{t("模型与供应商", "Models & providers")}</a>
          </p>
        )}
        <GeneratedConfig
          key={`${prefix}:${model}:${client}:${key}`}
          ready={validPrefix && !!model.trim() && !!key.trim()}
          text={make(key.trim())}
          preview={make("••••••")}
          check={async () => {
            const result = await request(prefix + "/models", {
              headers: { Authorization: `Bearer ${key.trim()}` },
              signal: AbortSignal.timeout(15000),
            });
            const available = Array.isArray(result?.data)
              ? result.data
              : listItems(result);
            if (
              !available.some((m: JsonRecord) => (m.id || m.model_id) === model)
            )
              throw new Error(
                t(
                  "Key 可以访问模型接口，但所选模型不在可用列表中，请检查模型 ID 和权限。",
                  "The key can access the model endpoint, but the selected model is not listed. Check its ID and permissions.",
                ),
              );
            return t(
              "模型列表访问成功，所选模型可见。尚未调用付费生成接口或验证实际回复。",
              "Model list accessible and the selected model is visible. No paid generation request or actual reply has been tested.",
            );
          }}
          note={t(
            "LLM 检查只读取模型列表，不发送生成请求。",
            "LLM checks only read the model list; no generation requests are sent.",
          )}
        />
      </section>
    </div>
  );
}
