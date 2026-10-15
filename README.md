# ContextForge Console

独立的 ContextForge 管理与使用控制台，以 **v1.0.11** 为 API 基线。支持管理员和普通用户、API Key 自助创建、RBAC、资源批量管理、运行时子路径配置，以及 MCP、LLM 和业务 API 的同源反代。

## 开发与运行

需要 Node.js 24 和独立运行的 ContextForge 后端。

```powershell
npm ci
Copy-Item .env.example .env
# 修改 .env 中的 BACKEND_URL 和 PUBLIC_ORIGIN
npm run build
node --env-file=.env apps/server/index.mjs
```

默认配置访问 `http://localhost:3000/forge/app/`。`npm run dev` 使用构建监听与 Node.js 重载；修改界面后刷新浏览器即可。

Linux / macOS 可用 `cp .env.example .env`。生产环境以环境变量配置，镜像无需按访问前缀重新构建。

## Docker

```sh
docker build -f deploy/Dockerfile -t contextforge-panel:local .
docker compose -f deploy/compose.yaml up -d
```

Compose 默认后端为宿主机 `http://host.docker.internal:4444`，只在宿主机回环地址发布前端端口。容器中的 `localhost` 是容器自身；其他部署方式请明确设置 `BACKEND_URL`。Compose 的环境变量从运行命令的环境或指定 `--env-file` 读取。

前端单容器不包含后端、数据库或 Redis。参考仓库不会被修改。

## 配置

| 变量                  | 示例                           | 作用                                                   |
| --------------------- | ------------------------------ | ------------------------------------------------------ |
| `APP_ROOT_PATH`       | `/forge`                       | 公共访问前缀；空字符串为域名根目录                     |
| `BACKEND_URL`         | `http://gateway:4444/internal` | 固定上游地址，可含独立内部前缀                         |
| `PUBLIC_ORIGIN`       | `https://tools.example.com`    | 浏览器所见的协议、域名和端口；用于 Origin 校验与重定向 |
| `COOKIE_SECURE`       | `true`                         | HTTPS 部署开启；本地 HTTP 为 `false`                   |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.1/32`                 | 允许读取转发客户端 IP 的前置代理网段；默认空           |
| `PORT` / `HOST`       | `3000` / `0.0.0.0`             | 监听地址                                               |

页面使用 `/forge/app/`；控制台内部接口使用 `/forge/_panel/`；其他公共业务路径剥离 `/forge` 后转发上游。`/forge/_internal/` 不对外开放。LLM 使用后端实际的 API 前缀，例如 `/forge/llm/v1/chat/completions`。MCP 虚拟服务器连接地址为 `/forge/servers/<id>/mcp`。

参见 [nginx 示例](deploy/nginx.conf.example) 和 [部署说明](docs/deployment.md)。

## 功能入口

- 资源目录：MCP 网关、虚拟服务器、Tools、Resources、Prompts、A2A、Roots，提供 CRUD、详情、相关操作与批量执行。
- 我的 API Key：按已有权限自助创建团队或服务器范围的 Key，设置有效期和权限；创建时复制明文；查看、更新、撤销与用量查询。
- 角色与权限：角色 CRUD、权限目录、用户角色查询、分配与按作用域撤销。
- 团队和用户：账户、成员、邀请、加入请求等操作。
- 模型与供应商、对话调试、插件、服务目录、可观测性、日志和系统配置。
- 接口工作台：使用实际 OpenAPI 参数和请求 Schema 执行业务操作，支持表单、JSON、文件、结果下载和流式读取。低频功能在该入口操作，不会因没有专门的列表页面而遗漏。

条件功能标明启用配置。内部服务接口、健康探测、已废弃方法和原前端 HTML 渲染接口被明确排除。协议能力由连接配置与调试入口覆盖。

完整逐项映射见 [coverage.csv](contracts/contextforge/coverage.csv)。接口映射不等于逐项集成验证；已执行的场景与限制见 [验证记录](docs/verification.md)。

## 质量检查

```sh
npm run check
npm run format:check
```

真实后端与浏览器测试的准备命令见 [开发与测试](docs/development.md)。Chat 使用独立 v1.0.10 测试环境，不改变 v1.0.11 主后端。

## 工程结构

```text
apps/web/                    React 页面与交互
apps/server/                 会话、配置、静态文件和固定上游反代
packages/api-client/         API 客户端、生成类型、契约和批量执行辅助函数
contracts/contextforge/      版本化规范、来源记录和功能覆盖清单
scripts/                     契约生成、隔离测试环境与开发命令
tests/                       单元、真实后端集成与浏览器测试
deploy/                      Docker、Compose、nginx
docs/                        架构、部署、维护和验证说明
```

架构约定见 [architecture.md](docs/architecture.md)。
