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

隔离测试启动器保留后端限流，但显式提高各请求层级的测试限额，以支持跨页资源夹具的连续创建与清理。这些设置仅用于 `.cache` 测试后端，不是生产吞吐能力或限流策略的验证。

浏览器测试在桌面和手机视口使用真实后端。测试用户和资源使用随机名称，结束时清理；后端软删除可能保留测试记录，不要在生产后端运行这些脚本。

资源界面的交互与导入格式约定见 [resource-workflows.md](resource-workflows.md)。新增栏目需单独决定基本场景与字段，避免直接使用 API 调用器承担列表操作。修改字段控件需检查权限搜索 / 批选、嵌套校验、编辑回填和敏感信息；导入改动需检查预览、确认、部分失败及模板兼容性。

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

`packages/api-client/contract.mjs` 维护 v1.0.11 直接读取 Request 的请求体补充。构建与实时规范合并均应用补充，不改写原始捕获；新增补充必须核对准确标签的后端解析逻辑和媒体类型，记录 `x-panel-request-body-source` 与字段完整性。工作台字段展示不应把可选字段误标为必填，也不应自动提交未填写的可选空值。覆盖清单包含请求体媒体类型、完整性与证据位置；`verified-fields` 表示已核对列出的字段，`opaque` 表示只确认有请求体并保留原始编辑，均不代表相关服务业务验证通过。修改补充后运行构建、`npm run contracts:types`、`node scripts/coverage.mjs`。

来源元数据的 `commit` 为 `git rev-parse v1.0.11^{commit}` 得到的源码提交，`tagObject` 单独记录 annotated tag 对象。源码提取和主后端准备脚本会核对固定基线。运行时捕获只知道配置端点返回的规范，不能单凭版本号证明端点运行了该提交，因此 `runtimeProvenanceVerified` 保持为 `false`。

## 工具调用专项验证

先按上文准备 v1.0.11 后端和浏览器，并构建前端，然后单独启动工具测试实例：

```sh
python scripts/start-test-backend.py --tool-calls
```

该实例使用独立的 `.cache/tool-call.db` 和 4446 端口，仅此测试配置允许 localhost 上游，不修改常规测试后端或生产 SSRF 策略。另一个终端执行：

```sh
npm run test:tool-call
```

脚本临时启动回环地址的 REST 测试服务，以及 3002 端口、`/tool-lab` 前缀的面板；创建随机公共 REST 工具，从浏览器填写 Schema 表单并实际执行 `/rpc`，核对上游只收到一次且参数类型正确、结果呈现正常，再从接口工作台执行真实 `ping`。同时使用只读 API Key 验证工具调用被拒绝。结束后清理工具、Key、面板和上游服务；测试后端由启动它的终端停止。该专项不依赖外部 MCP 或付费模型，不表示外部服务认证、调用已验收。

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
