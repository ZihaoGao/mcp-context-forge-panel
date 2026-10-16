import { resolveSchema } from "../../../packages/api-client/contract.mjs";

// Each resource has a different first task. Keep these choices explicit rather
// than exposing every API property as a required-looking field.
export const resourceProfiles = {
  servers: {
    noun: "虚拟服务器",
    purpose: "命名服务，选择要提供给 MCP 客户端的工具、资源和提示词。",
    fields: [
      "name",
      "description",
      "visibility",
      "team_id",
      "associated_tools",
      "associated_resources",
      "associated_prompts",
      "associated_a2a_agents",
    ],
    defaults: { visibility: "private" },
  },
  gateways: {
    noun: "MCP 网关",
    purpose: "填写上游 MCP 地址和连接方式。保存时后端会连接上游并发现工具。",
    fields: [
      "name",
      "url",
      "transport",
      "description",
      "authType",
      "authUsername",
      "authPassword",
      "authToken",
      "authHeaderKey",
      "authHeaderValue",
      "authQueryParamKey",
      "authQueryParamValue",
      "oauthConfig",
      "visibility",
      "teamId",
    ],
    defaults: {
      transport: "STREAMABLEHTTP",
      visibility: "private",
      authType: "none",
    },
  },
  tools: {
    noun: "工具",
    purpose:
      "注册一个可调用的端点。接入整个 MCP 服务请使用「MCP 网关」，无需逐个创建工具。",
    fields: [
      "name",
      "description",
      "integration_type",
      "url",
      "request_type",
      "inputSchema",
      "outputSchema",
      "visibility",
      "team_id",
    ],
    defaults: {
      integration_type: "REST",
      request_type: "POST",
      visibility: "private",
    },
  },
  resources: {
    noun: "资源",
    purpose:
      "为客户端提供可读取的文本内容。URI 是资源的唯一标识，例如 context://handbook。",
    fields: [
      "name",
      "uri",
      "description",
      "mimeType",
      "content",
      "visibility",
      "team_id",
    ],
    defaults: { mimeType: "text/plain", visibility: "private" },
  },
  prompts: {
    noun: "提示词",
    purpose: "编写可复用的模板，并声明模板中使用的参数。",
    fields: [
      "name",
      "description",
      "template",
      "arguments",
      "visibility",
      "teamId",
    ],
    defaults: { visibility: "private", arguments: [] },
  },
  a2a: {
    noun: "A2A 智能体",
    purpose: "连接兼容 A2A 协议的智能体；地址和认证配置必须与目标服务一致。",
    fields: [
      "name",
      "endpoint_url",
      "description",
      "agent_type",
      "protocol_version",
      "auth_type",
      "auth_username",
      "auth_password",
      "auth_token",
      "auth_header_key",
      "auth_header_value",
      "auth_query_param_key",
      "auth_query_param_value",
      "oauth_config",
      "visibility",
      "team_id",
    ],
    defaults: { visibility: "private", auth_type: "none" },
  },
  roots: {
    noun: "根目录",
    purpose:
      "声明 MCP 客户端可访问的根目录或文件 URI，例如 file:///workspace。",
    fields: ["name", "uri"],
    defaults: {},
  },
  tokens: {
    noun: "API Key",
    purpose:
      "为一个应用单独创建 Key。建议设置有效期并限制权限；明文只在创建成功后显示一次。",
    fields: ["name", "description", "expires_in_days", "team_id", "scope"],
    defaults: { expires_in_days: 30, scope: { permissions: [] } },
  },
  teams: {
    noun: "团队",
    purpose: "建立协作空间。私有团队需要邀请或审批；公共团队可被其他用户发现。",
    fields: [
      "name",
      "description",
      "visibility",
      "slug",
      "max_members",
      "members",
    ],
    defaults: { visibility: "private" },
  },
  users: {
    noun: "用户",
    purpose: "创建登录账户。请为用户分配适当角色，并通过安全渠道交付初始密码。",
    fields: [
      "email",
      "full_name",
      "password",
      "password_change_required",
      "is_active",
      "is_admin",
    ],
    defaults: {
      password_change_required: true,
      is_active: true,
      is_admin: false,
    },
  },
  rbac: {
    noun: "角色",
    purpose:
      "选择角色适用范围和权限。团队角色需要在分配时指定团队；权限可按关键词批量选择。",
    fields: ["name", "description", "scope", "permissions", "inherits_from"],
    defaults: { scope: "team", permissions: [] },
  },
  llm: {
    noun: "模型供应商",
    purpose:
      "配置模型服务连接。API Key 仅用于后端访问供应商，保存后不会返回明文。",
    fields: [
      "name",
      "provider_type",
      "api_base",
      "api_key",
      "api_version",
      "default_model",
      "description",
      "enabled",
    ],
    defaults: { enabled: true },
  },
  plugins: {
    noun: "插件",
    purpose: "查看插件配置及其绑定的资源。修改前请检查插件要求的配置。",
    fields: ["name", "description", "enabled", "config"],
    defaults: {},
  },
  catalog: {
    noun: "目录服务",
    purpose: "浏览预置服务并注册到 MCP 网关；注册时填写当前环境的连接配置。",
    fields: ["name", "url", "transport", "description"],
    defaults: { visibility: "private" },
  },
};

export const fieldCopy = {
  name: ["名称", "使用可识别的名称，便于在列表中查找。"],
  description: ["说明", "描述用途，帮助团队理解何时使用。"],
  visibility: [
    "可见性",
    "private：仅所有者；team：所属团队；public：所有获准用户。可见性不能替代 API Key 和 RBAC 授权。",
  ],
  team_id: [
    "所属团队",
    "留空时由后端按当前用户处理。团队可见资源需要选择团队。",
  ],
  teamId: ["所属团队", "团队可见资源需要选择团队。"],
  scope_id: ["适用团队", "团队范围的角色分配必须选择团队。"],
  server_id: [
    "限制到虚拟服务器",
    "留空允许访问权限范围内的所有服务器；选择后此 Key 只能访问该服务器。",
  ],
  scope: ["访问范围", "可限制服务器、具体权限、来源 IP 和使用额度。"],
  activate: [
    "启用状态",
    "选择「是」启用；选择「否」停用。停用会影响正在使用此资源的客户端。",
  ],
  purge_metrics: [
    "同时删除历史统计",
    "默认保留历史统计，便于追溯。选择「是」会一并清除该资源的指标。",
  ],
  mode: [
    "插件运行模式",
    "enforce 强制执行；permissive 宽松执行；disabled 停用。其他模式由已安装插件的运行时支持。",
  ],
  authUsername: ["认证用户名", "上游 Basic 认证账户。"],
  authPassword: ["认证密码", "上游 Basic 认证密码；编辑时留空保留原值。"],
  authToken: ["访问令牌", "填写令牌本身，不需要 Bearer 前缀。"],
  auth_username: ["认证用户名", "目标服务 Basic 认证账户。"],
  auth_password: ["认证密码", "目标服务 Basic 认证密码；编辑时留空保留原值。"],
  auth_token: ["访问令牌", "填写令牌本身，不需要 Bearer 前缀。"],
  authHeaderKey: ["认证请求头名称", "例如 X-API-Key。"],
  authHeaderValue: ["认证请求头值", "填写目标服务要求的凭据。"],
  auth_header_key: ["认证请求头名称", "例如 X-API-Key。"],
  auth_header_value: ["认证请求头值", "填写目标服务要求的凭据。"],
  authQueryParamKey: [
    "认证参数名称",
    "目标服务使用的查询参数名称，例如 api_key。",
  ],
  authQueryParamValue: ["认证参数值", "目标服务颁发的 API Key。"],
  auth_query_param_key: ["认证参数名称", "例如 api_key。"],
  auth_query_param_value: ["认证参数值", "目标服务颁发的 API Key。"],
  oauthConfig: [
    "OAuth 配置",
    "填写目标服务的 OAuth 客户端配置 JSON。具体字段取决于目标授权服务器。",
  ],
  oauth_config: ["OAuth 配置", "填写目标服务要求的 OAuth 客户端配置 JSON。"],
  oauth_credentials: [
    "OAuth 凭据",
    "该目录服务要求的 OAuth 配置 JSON，请参考服务文档。",
  ],
  time_restrictions: [
    "可用时段（高级）",
    "可选 JSON 配置，由后端按其时段限制规则解释；不确定时留空。",
  ],
  usage_limits: [
    "调用额度（高级）",
    "可选 JSON 配置，由后端按其额度规则解释；不确定时留空。",
  ],
  expires_at: [
    "到期时间",
    "可选，使用带时区的 ISO 时间，例如 2026-12-31T23:59:00Z。",
  ],
  permissions: ["权限", "搜索后可全选匹配项，也可以清空选择。"],
  expires_in_days: [
    "有效天数",
    "从创建时起计算，至少 1 天。留空表示不设到期时间，请谨慎使用。",
  ],
  url: [
    "服务地址",
    "填写完整的 http:// 或 https:// 地址。后端必须能够访问此地址。",
  ],
  endpoint_url: ["智能体地址", "填写 A2A 服务的完整 HTTP(S) 地址。"],
  transport: [
    "连接方式",
    "Streamable HTTP 用于现代 MCP 服务；SSE 用于使用事件连接的旧服务。",
  ],
  authType: ["认证方式", "与上游服务保持一致；无认证选择 none。"],
  auth_type: ["认证方式", "与目标智能体保持一致；无认证选择 none。"],
  associated_tools: [
    "提供的工具",
    "搜索并选择客户端可调用的工具；不选择则不提供工具。",
  ],
  associated_resources: ["提供的资源", "选择客户端可读取的资源。"],
  associated_prompts: ["提供的提示词", "选择客户端可使用的提示词模板。"],
  associated_a2a_agents: [
    "提供的智能体",
    "选择需要通过此服务器提供的 A2A 智能体。",
  ],
  uri: [
    "资源 URI",
    "必须包含协议，例如 context://handbook 或 file:///workspace。",
  ],
  content: ["资源内容", "客户端读取该资源时收到的文本。"],
  mimeType: [
    "内容类型",
    "例如 text/plain、application/json 或 text/markdown。",
  ],
  template: ["模板内容", "填写提示词正文。参数应与下面声明的名称一致。"],
  arguments: ["模板参数", "为模板中的每个变量添加名称、说明，并标明是否必填。"],
  inputSchema: [
    "输入参数结构",
    'JSON Schema 对象，用于描述调用者应提供的参数。例如 {"type":"object","properties":{}}。',
  ],
  outputSchema: ["输出结构", "可选的 JSON Schema，用于描述工具返回值。"],
  request_type: [
    "调用方式",
    "REST 工具选择 HTTP 方法；MCP 工具按实际传输方式配置。",
  ],
  integration_type: [
    "集成类型",
    "REST：HTTP 接口；MCP：MCP 工具；A2A：智能体。",
  ],
  email: ["邮箱地址", "使用有效邮箱作为登录账户。"],
  full_name: ["显示名称", "用于在团队和审计记录中识别用户。"],
  password: ["初始密码", "至少 8 位。后端还可能启用更严格的密码策略。"],
  password_change_required: [
    "首次登录修改密码",
    "建议开启，避免长期使用管理员设置的初始密码。",
  ],
  is_admin: ["平台管理员", "管理员可管理全平台用户和配置，请谨慎授予。"],
  is_active: ["账户 / Key 状态", "停用后不可继续使用。"],
  enabled: ["启用", "关闭后暂停此配置。"],
  slug: ["团队短名称", "可选，仅小写字母、数字和连字符，至少 2 个字符。"],
  max_members: ["成员上限", "至少 1 人。留空使用系统默认上限。"],
  members: ["初始成员", "已有用户会加入团队，其他邮箱由后端发送邀请。"],
  inherits_from: ["继承角色", "可选，继承父角色的权限。"],
  role_id: ["角色", "选择要分配的角色。"],
  user_email: ["用户邮箱", "选择操作对象；代其他用户创建 Key 需要管理员权限。"],
  api_base: [
    "API 基础地址",
    "例如 https://api.example.com/v1；留空使用该供应商的默认地址。",
  ],
  api_key: ["供应商 API Key", "由后端加密保存；编辑时留空表示不更换。"],
  provider_type: ["供应商类型", "按实际使用的模型服务选择。"],
  api_version: ["API 版本", "Azure 等服务可能要求指定版本。"],
  default_model: ["默认模型", "填写供应商提供的模型标识。"],
  tags: ["标签", "每行一个标签，用于分类和搜索。"],
  ip_restrictions: [
    "允许的来源 IP",
    "每行一个 IP 地址或 CIDR 网段。留空不限制来源。后端须正确配置可信反向代理。",
  ],
};

export function resourceBody(schema, spec) {
  const root = resolveSchema(schema, spec);
  const wrapper = [
    "server",
    "gateway",
    "tool",
    "resource",
    "prompt",
    "agent",
  ].find((k) => root.properties?.[k]);
  return {
    root,
    wrapper,
    schema: resolveSchema(wrapper ? root.properties[wrapper] : root, spec),
  };
}
export function enrichField(key, original, spec) {
  const s = { ...resolveSchema(original, spec) };
  if (!s.enum && ["visibility"].includes(key))
    s.enum = ["private", "team", "public"];
  if (!s.enum && ["authType", "auth_type"].includes(key))
    s.enum = ["none", "basic", "bearer", "authheaders", "oauth", "query_param"];
  if (!s.enum && key === "transport") s.enum = ["STREAMABLEHTTP", "SSE"];
  if (!s.enum && key === "gatewayMode") s.enum = ["cache", "direct_proxy"];
  const choices = s.pattern?.match(/^\^\(([^()]+)\)\$$/);
  if (
    !s.enum &&
    choices &&
    choices[1].split("|").every((v) => /^[\w-]+$/.test(v))
  )
    s.enum = choices[1].split("|");
  return s;
}

/** Shared by forms and import preview; never send a row with known invalid data. */
export function validateValue(value, original, spec, path = "") {
  let schema = resolveSchema(original, spec);
  const errors = [];
  const alternatives = (original?.anyOf || original?.oneOf || [])
    .map((v) => resolveSchema(v, spec))
    .filter((v) => v.type !== "null");
  if (alternatives.length > 1) {
    const type = Array.isArray(value)
      ? "array"
      : typeof value === "object"
        ? "object"
        : typeof value;
    const match = alternatives.find(
      (v) => v.type === type || (type === "number" && v.type === "integer"),
    );
    if (match)
      schema = { ...original, anyOf: undefined, oneOf: undefined, ...match };
  }
  const at = path || "内容";
  if (value === undefined) return errors;
  if (value === null) {
    if (
      original?.nullable ||
      original?.type === "null" ||
      [...(original?.anyOf || []), ...(original?.oneOf || [])].some(
        (v) => v.type === "null",
      )
    )
      return errors;
    return [`${at} 不能为 null`];
  }
  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${at}：请选择 ${schema.enum.join(" / ")}`);
  if (schema.type === "object" || schema.properties) {
    if (typeof value !== "object" || Array.isArray(value))
      return [`${at} 必须是对象`];
    for (const key of schema.required || [])
      if (
        value[key] === undefined ||
        (typeof value[key] === "string" && !value[key].trim()) ||
        value[key] === null
      )
        errors.push(`${path ? path + "." : ""}${key}：必填`);
    for (const [key, v] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child)
        errors.push(
          ...validateValue(
            v,
            enrichField(key, child, spec),
            spec,
            path ? `${path}.${key}` : key,
          ),
        );
      else if (schema.additionalProperties === false)
        errors.push(`${key}：不支持的字段`);
    }
    if (value.visibility === "team" && !value.team_id && !value.teamId)
      errors.push("团队可见资源必须选择所属团队");
    if (
      value.scope === "team" &&
      schema.properties?.scope_id &&
      !value.scope_id
    )
      errors.push("团队角色分配必须选择适用团队");
    const auth = value.authType || value.auth_type;
    const needed =
      auth === "basic"
        ? ["authUsername", "auth_username", "authPassword", "auth_password"]
        : auth === "bearer"
          ? ["authToken", "auth_token"]
          : auth === "query_param"
            ? [
                "authQueryParamKey",
                "auth_query_param_key",
                "authQueryParamValue",
                "auth_query_param_value",
              ]
            : [];
    for (const key of needed.filter((k) => schema.properties?.[k]))
      if (!value[key]) errors.push(`${key}：此认证方式需要填写`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${at} 必须是数组`];
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${at} 至少 ${schema.minItems} 项`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${at} 最多 ${schema.maxItems} 项`);
    value.forEach((v, i) =>
      errors.push(...validateValue(v, schema.items, spec, `${at}[${i + 1}]`)),
    );
  } else if (["integer", "number"].includes(schema.type)) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value))
    )
      errors.push(`${at} 必须是${schema.type === "integer" ? "整数" : "数字"}`);
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${at} 最小值为 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${at} 最大值为 ${schema.maximum}`);
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    errors.push(`${at} 必须是布尔值`);
  else if (schema.type === "string") {
    if (typeof value !== "string") return [`${at} 必须是文本`];
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${at} 至少 ${schema.minLength} 个字符`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${at} 最多 ${schema.maxLength} 个字符`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value))
          errors.push(`${at} 格式不符合要求：${schema.pattern}`);
      } catch {
        /* Backend-only regex dialect. */
      }
    }
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      errors.push(`${at}：请输入有效邮箱`);
    if (
      value &&
      (schema.format === "uri" ||
        /(^|\.)(uri|url|endpoint_url|api_base|base_url)$/.test(path))
    ) {
      try {
        const u = new URL(value);
        if (!path.endsWith("uri") && !["http:", "https:"].includes(u.protocol))
          errors.push(`${at} 需要 http:// 或 https:// 地址`);
      } catch {
        errors.push(`${at}：请输入包含协议的完整地址`);
      }
    }
    if (/ip_restrictions\[\d+\]$/.test(path)) {
      const parts = value.split("/");
      const address = parts[0];
      let valid = false;
      let bits = 32;
      if (address.includes(":")) {
        bits = 128;
        try {
          valid = !!new URL(`http://[${address}]/`).hostname;
        } catch {
          valid = false;
        }
      } else
        valid =
          /^\d{1,3}(\.\d{1,3}){3}$/.test(address) &&
          address.split(".").every((v) => Number(v) <= 255);
      if (
        parts.length > 2 ||
        (parts.length === 2 &&
          (!/^\d+$/.test(parts[1]) || Number(parts[1]) > bits))
      )
        valid = false;
      if (!valid) errors.push(`${at}：请输入有效 IP 或 CIDR 网段`);
    }
  }
  return errors;
}

export function portableRecord(value, original, spec) {
  const schema = resolveSchema(original, spec);
  if (Array.isArray(value))
    return value.map((v) => portableRecord(v, schema.items, spec));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(schema.properties || {})) {
    const s = resolveSchema(child, spec);
    if (s.readOnly || s.writeOnly || sensitiveKey(key)) continue;
    let v = readField(value, key);
    if (
      v === undefined ||
      v === null ||
      ["id", "owner_email", "ownerEmail", "user_email"].includes(key)
    )
      continue;
    // GET records may expose encrypted/placeholder authentication; require
    // deliberate re-entry rather than serializing unusable credentials.
    if (["authType", "auth_type"].includes(key) && v !== "none") v = "none";
    if (key === "tags" && Array.isArray(v))
      v = v.map((tag) => (typeof tag === "string" ? tag : tag.label || tag.id));
    out[key] = s.properties ? portableRecord(v, child, spec) : redactSecrets(v);
  }
  return out;
}

export function readField(record, key) {
  const snake = key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
  const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  if (key === "associated_tools")
    return (
      record.associatedToolIds ??
      record.associated_tools ??
      record.associatedTools
    );
  return record[key] ?? record[snake] ?? record[camel];
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      let changed = !!(url.username || url.password);
      url.username = "";
      url.password = "";
      for (const key of [...url.searchParams.keys()])
        if (sensitiveKey(key) || key.toLowerCase() === "auth") {
          url.searchParams.delete(key);
          changed = true;
        }
      return changed ? url.href : value;
    } catch {
      return value;
    }
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !(key === "value" && sensitiveKey(value.key || value.name || "")),
        )
        .filter(([key]) => !sensitiveKey(key))
        .map(([key, v]) => [key, redactSecrets(v)]),
    );
  return value;
}

export function sensitiveKey(key) {
  return /password|secret|credential|authorization|cookie|(?:^|[-_])api[-_]?key(?:$|[-_])|^(token|access_token|refresh_token|id_token|jwt_token|api[_-]?key|client[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key)$|^auth.*(token|value|header|query|username)|(?:database|redis|smtp)[_-]?url|dsn/i.test(
    key,
  );
}
export function safeDisplay(value, key = "") {
  if (sensitiveKey(key) && typeof value !== "boolean") return "••••••";
  if (typeof value === "string")
    return value
      .replace(/(https?:\/\/[^\s/@:]+):[^\s/@]+@/gi, "$1:••••••@")
      .replace(
        /([?&](?:token|access_token|auth|authorization|api[_-]?key|password|secret)=)[^&\s]+/gi,
        "$1••••••",
      );
  if (Array.isArray(value)) return value.map((v) => safeDisplay(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "value" && sensitiveKey(value.key || value.name || "")
          ? "••••••"
          : safeDisplay(v, k),
      ]),
    );
  return value;
}

export function downloadJson(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
