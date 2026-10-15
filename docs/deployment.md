# 部署与代理配置

## 公共前缀与后端前缀

`APP_ROOT_PATH` 表示控制台服务的公共前缀，不要求与后端自己的 `APP_ROOT_PATH` 相同。代理始终剥离公共前缀一次，再添加 `BACKEND_URL` 的 pathname。

例如公共入口 `https://tools.example.com/forge`，上游 `http://gateway:4444/internal`：

- `/forge/app/` 由控制台提供。
- `/forge/v1/tools?limit=25` 转发为 `/internal/v1/tools?limit=25`。
- `/forge/servers/<id>/mcp` 转发为 `/internal/servers/<id>/mcp`。
- `/forge/llm/v1/chat/completions` 转发为 `/internal/llm/v1/chat/completions`。

nginx 保留原始 URI 转给控制台，不要在 `proxy_pass` 后加 `/` 二次剥离。`PUBLIC_ORIGIN` 必须设置为实际外部 Origin，包括非默认端口。HTTPS 时设置 `COOKIE_SECURE=true`。

如需 API Key 的 IP 限制、按 IP 审计和限流，把前置 nginx 的实际地址或网段加入控制台 `TRUSTED_PROXY_CIDRS`。控制台从右向左解析受信任的代理链，忽略直连客户端伪造的转发头，并向后端发送确定的客户端 IP。后端 Uvicorn 还需通过 `FORWARDED_ALLOW_IPS` 等运行配置明确信任控制台地址；这与关闭业务鉴权无关。Docker 中请使用实际容器网络地址，不能假定前置代理为回环地址。

## 流式请求

nginx 禁用响应缓冲和缓存，并配置足够长的读写超时；WebSocket 转发 Upgrade/Connection。控制台不缓存外部 MCP/LLM 响应，保留会话与协议头。旧版 MCP SSE 的 `endpoint` 事件会将消息地址转换到公共前缀；其他事件和 LLM Token 原样转发。浏览器调试可主动停止读取，客户端退出时代理结束对应连接。

## 会话与认证

邮箱登录取得的后端 JWT 保存在控制台进程的会话表中。浏览器只保存随机会话标识，Cookie 具有 HttpOnly、SameSite=Lax 和部署路径限制。前端写请求验证 `Origin`。会话最长 24 小时，不超过后端响应的过期时间；容量上限为 10000，过期项定期清理。

控制台重启会使浏览器会话失效，需要重新登录。当前交付面向单实例，不应在没有共享会话存储的情况下增加副本。登出首先删除本地会话，再调用后端撤销；后端撤销失败不恢复本地会话。

外部客户端直接携带自己的 `Authorization`，优先级高于浏览器会话。只有控制台明确标记的请求才可使用服务端会话。控制台 Cookie 和旧后端 JWT Cookie 不转发到普通业务请求。旧版 Chat connect 依赖后端 Cookie，代理仅对经过控制台认证的该接口补充 Cookie。

## SSO

后端开启 `SSO_ENABLED` 且配置供应商时，登录页显示供应商入口。供应商回调地址设为公共地址 `/forge/v1/auth/sso/callback/<provider_id>`，并按后端要求将公共 Origin 加入允许列表。后端处理 OAuth 状态、浏览器绑定和用户创建；控制台验证回调返回的凭据后建立自己的会话，跳转新界面。

尚未使用外部企业 IdP 验证完整 SSO；生产接入需使用实际供应商完成回调与审批策略验收。供应商、待审批用户等管理接口可通过接口工作台配置。

## Chat 兼容性

v1.0.11 依赖 MCP 2.x，当前 LangChain MCP Chat 适配器依赖 MCP 1.x，两者不能放在同一个正确求解的依赖环境。Chat 测试使用独立 v1.0.10 后端。正式使用时可运行单独的控制台实例连接兼容后端；主控制台仍连接 v1.0.11，不做隐式跨后端路由。

Chat 的 MCP 地址必须能从后端访问，并满足后端 SSRF 策略。界面不绕过这些校验。测试环境只为本地测试明确开放回环地址。

## 配置边界

功能开关、上游凭据、数据库、RBAC、SSO 用户审批等由后端管理。控制台不会写入后端仓库或环境文件。缺少业务配置、权限或第三方连接时，显示后端错误与状态；不会以模拟成功代替实际操作。
