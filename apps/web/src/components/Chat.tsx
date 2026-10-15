import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Send, PlugZap, Square, Unplug } from "lucide-react";
import {
  config,
  request,
  send,
  displayError,
} from "../../../../packages/api-client";
import { listItems } from "../../../../packages/api-client/contract.mjs";

export function Chat({ en = false }: { en?: boolean }) {
  const [model, setModel] = useState("");
  const [server, setServer] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    [],
  );
  const [error, setError] = useState("");
  const session = useRef("");
  const abort = useRef<AbortController | null>(null);
  const models = useQuery({
    queryKey: ["chat-models"],
    queryFn: () => request("/v1/llmchat/gateway/models"),
    retry: false,
  });
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await send("/v1/llmchat/connect", "POST", {
        user_id: "",
        llm: { model },
        ...(server
          ? { server: { url: server, transport: "streamable_http" } }
          : {}),
        streaming: true,
      });
      session.current = result.user_id;
      setConnected(true);
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const message = input;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ]);
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const response = await fetch(config.prefix + "/v1/llmchat/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Panel-Request": "1" },
        body: JSON.stringify({
          user_id: session.current,
          message,
          streaming: true,
        }),
        signal: abort.current.signal,
      });
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      if (
        !response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        const result = await response.json();
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content:
              result.response ||
              result.message ||
              JSON.stringify(result, null, 2),
          },
        ]);
      } else {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let output = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const line of lines)
            if (line.startsWith("data:")) {
              const text = line.slice(5).trim();
              if (!text || text === "[DONE]") continue;
              try {
                const event = JSON.parse(text);
                if (event.type === "error" || event.error)
                  throw new Error(event.error || event.message);
                const part =
                  event.token ??
                  event.content ??
                  event.delta ??
                  event.response ??
                  event.message ??
                  "";
                if (typeof part === "string") {
                  if (
                    event.type === "final" ||
                    event.type === "done" ||
                    event.response
                  )
                    output = part;
                  else output += part;
                }
              } catch (err) {
                if (err instanceof SyntaxError) output += text;
                else throw err;
              }
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: output },
              ]);
            }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-layout">
      <section className="panel chat-config">
        <div className="title-with-icon">
          <PlugZap size={20} />
          <h3>{en ? "Session configuration" : "会话配置"}</h3>
        </div>
        <label className="field">
          {en ? "Model" : "模型"}
          <input
            list="chat-models"
            value={model}
            aria-label="Chat model"
            placeholder="Model ID"
            onChange={(e) => setModel(e.target.value)}
            disabled={connected}
          />
          <datalist id="chat-models">
            {listItems(models.data).map((m: any) => (
              <option key={m.id || m.model_id} value={m.id || m.model_id}>
                {m.name || m.model_id}
              </option>
            ))}
          </datalist>
        </label>
        <label className="field">
          {en ? "MCP server URL (optional)" : "MCP 服务地址（可选）"}
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://…/mcp"
            disabled={connected}
          />
        </label>
        {connected ? (
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              try {
                await send("/v1/llmchat/disconnect", "POST", {
                  user_id: session.current,
                });
                setConnected(false);
              } catch (err) {
                setError(displayError(err));
              }
            }}
          >
            <Unplug size={16} />
            {en ? "Disconnect" : "断开连接"}
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!model || busy}
            onClick={connect}
          >
            <PlugZap size={16} />
            {busy
              ? en
                ? "Connecting…"
                : "连接中…"
              : en
                ? "Connect"
                : "建立连接"}
          </button>
        )}
        <div className="alert warning">
          {en
            ? "ContextForge 1.0.11 has a known Chat limitation. Compatibility validation uses an older backend."
            : "ContextForge 1.0.11 的 Chat 存在已知问题；此功能需使用兼容的旧版后端验证。"}
        </div>
      </section>
      <section className="panel chat-panel">
        <div className="chat-messages">
          {!messages.length && (
            <div className="empty">
              <Bot size={36} />
              <h3>
                {en ? "Test models with your tools" : "让模型使用你的工具"}
              </h3>
              <p>
                {en
                  ? "Choose a model and connect to start a conversation."
                  : "选择模型并建立连接后，开始测试对话。"}
              </p>
            </div>
          )}
          {messages.map((message, i) => (
            <article key={i} className={`chat-message ${message.role}`}>
              <strong>
                {message.role === "user" ? (en ? "You" : "你") : "Assistant"}
              </strong>
              <pre>{message.content || "…"}</pre>
            </article>
          ))}
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <form className="chat-composer" onSubmit={submit}>
          <textarea
            rows={2}
            aria-label="Message"
            placeholder={en ? "Write a message…" : "输入消息…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!connected}
          />
          {busy ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Stop generation"
              onClick={() => abort.current?.abort()}
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={!connected || !input.trim()}
            >
              <Send size={17} />
              {en ? "Send" : "发送"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
