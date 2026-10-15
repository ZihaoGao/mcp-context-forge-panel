# 开发与测试

## 常用命令

```sh
npm ci
npm run dev
npm run check
npm run format
npm run format:check
```

生产构建包含 TypeScript 检查、Vite 构建和按运行时加载的契约资产。OpenAPI 生成类型存于 `packages/api-client/schema.d.ts`，不要手工编辑。

## 精确版本后端

本地需要 Git、Python 3.12 或更高版本用于准备脚本，以及 uv。参考仓库默认路径为相邻的 `../mcp-context-forge`，仅通过 Git 读取标签；测试副本、虚拟环境、依赖解析结果和随机测试凭据全部位于已忽略的 `.cache/`。

```sh
python scripts/prepare-backend.py --repo ../mcp-context-forge --tag v1.0.11
python scripts/start-test-backend.py
```

后端监听回环地址 4444。另一个终端运行前端服务，配置：

```text
APP_ROOT_PATH=/forge
BACKEND_URL=http://127.0.0.1:4444
PUBLIC_ORIGIN=http://127.0.0.1:3000
COOKIE_SECURE=false
```

```sh
npm run build
npm start
npm run test:integration
node scripts/playwright.mjs install chromium
npm run test:e2e
```

浏览器测试在桌面和手机视口使用真实后端。测试用户和资源使用随机名称，结束时清理；后端软删除可能保留测试记录，不要在生产后端运行这些脚本。

## 生成接口契约

```sh
npm run contracts:source
```

此命令从准确标签提取 `main.py`、后端 `routers` 和 admin API 的 HTTP 装饰器与依赖元数据，不提取渲染函数体、模板或前端资产。源码中的路径尚未经过 router 挂载，不能替代 OpenAPI；无法静态确定的授权条件明确标注由后端校验，不推断为无权限限制。

运行中的隔离测试后端可设置 `CONTRACT_USE_TEST_CREDENTIALS=true` 后执行 `npm run contracts:live`；其他后端设置 `CONTRACT_BACKEND_URL` 与 `CONTRACT_TOKEN`。不要将 Token 写入命令历史或提交文件。

对 Vault、SIEM 和 ToolOps，额外运行：

```sh
.cache/backend-venv/Scripts/python.exe scripts/export-optional-contract.py
node scripts/build-contract.mjs
npm run contracts:types
node scripts/coverage.mjs
```

Linux 使用 `.cache/backend-venv/bin/python`。此导出过程从后端 API router 生成规范，不启动外部服务的 lifespan，不代表 Vault、SIEM 或 ToolOps 连接验证通过。前端合并基线规范与实时规范，实时不存在的方法标记未启用。

`openapi.json` 是实时捕获；`optional-openapi.json` 是明确配置条件的补充规范；`web-contract.json` 删除冗长示例和文档段落供浏览器加载；`coverage.json/csv` 逐项说明界面入口及排除原因。

## 独立 Chat 验证

```sh
python scripts/prepare-backend.py --tag v1.0.10 --chat
python scripts/start-test-backend.py --chat
```

旧后端监听 4445。另一个终端：

```sh
npm run build
node tests/integration/chat.mjs
```

测试脚本临时启动 3001 上的控制台、本地 OpenAI-compatible 服务和 MCP HTTP 服务，使用真实 v1.0.10 完成浏览器连接、SSE 回复和断开。它不调用付费模型，也不验证供应商的实际生成质量。

## 提交要求

变更业务行为时覆盖相应成功与拒绝场景，特别是匿名、跨团队、权限不足和功能关闭。提交前执行 `npm run check` 与格式检查；修改反代或鉴权时运行真实后端集成测试；修改表单或导航时运行浏览器测试。接口覆盖清单的条目只能表示映射完成，不能自动视为端到端验证。
