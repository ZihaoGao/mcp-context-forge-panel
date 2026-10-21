import { readField } from "./resource-model.mjs";
import { inputCompatibilityError } from "./tool-test.mjs";

export const restToolExamples = [
  {
    id: "search_products",
    title: { zh: "搜索商品", en: "Search products" },
    purpose: {
      zh: "GET 将调用参数放入 query；用 API Key 请求头认证，并用 jq 逐项提取产品 ID、名称、价格。匹配结果汇集为数组，outputSchema 描述该结果数组。",
      en: "GET sends arguments as query parameters. Authenticate with an API Key header and use jq to emit each product's ID, name and price. Matches are collected into an array described by outputSchema.",
    },
    replace: {
      zh: "替换 url 和 auth.authHeaders 中的 API Key；按实际响应调整 jsonpath_filter（填写 jq 表达式）及 outputSchema。示例预期响应为 {products: [{id, name, price, ...}]}。调用参数示例显式包含分页值；Schema 的 default 不保证由后端自动补齐。",
      en: "Replace url and the API Key in auth.authHeaders. Adapt jsonpath_filter (a jq expression) and outputSchema to your response. The example expects {products: [{id, name, price, ...}]}. Call arguments explicitly include pagination values; schema defaults are not guaranteed to be inserted by the backend.",
    },
    arguments: { keyword: "coffee", page: 1, page_size: 20, sort: "relevance" },
    tool: {
      name: "search_products",
      description: "按关键词搜索商品 / Search products by keyword",
      integration_type: "REST",
      request_type: "GET",
      url: "https://api.example.com/products",
      auth: {
        authType: "authheaders",
        authHeaders: [{ key: "X-API-Key", value: "REPLACE_WITH_API_KEY" }],
      },
      inputSchema: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            minLength: 1,
            description: "搜索关键词 / Search term",
          },
          page: { type: "integer", minimum: 1, default: 1 },
          page_size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          sort: {
            type: "string",
            enum: ["relevance", "price_asc", "price_desc"],
            default: "relevance",
          },
        },
        required: ["keyword"],
        additionalProperties: false,
      },
      jsonpath_filter: ".products[] | {id, name, price}",
      outputSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            price: { type: "number", minimum: 0 },
          },
          required: ["id", "name", "price"],
          additionalProperties: false,
        },
      },
      visibility: "private",
    },
  },
  {
    id: "create_order",
    title: { zh: "创建订单", en: "Create an order" },
    purpose: {
      zh: "POST 将 customer_id 替换到 URL 路径，剩余参数作为 JSON body，使用 Bearer 认证。商品数组、嵌套地址和加急布尔值保留各自类型。",
      en: "POST substitutes customer_id into the URL path and sends the remaining arguments as a JSON body with Bearer authentication. Item arrays, nested addresses and the expedited boolean retain their types.",
    },
    replace: {
      zh: "替换 url 的域名和 auth.token；保留 {customer_id} 占位符，并按实际接口调整商品、地址字段及必填项。customer_id 不会重复发送到 body。",
      en: "Replace the URL host and auth.token. Keep the {customer_id} placeholder and adapt item/address fields and required properties to your API. customer_id is not repeated in the body.",
    },
    arguments: {
      customer_id: "customer-123",
      items: [{ product_id: "coffee-001", quantity: 2 }],
      shipping_address: {
        street: "123 Example Street",
        city: "Berlin",
        postal_code: "10115",
      },
      expedited: true,
    },
    tool: {
      name: "create_order",
      description: "为客户创建订单 / Create an order for a customer",
      integration_type: "REST",
      request_type: "POST",
      url: "https://api.example.com/customers/{customer_id}/orders",
      auth: { authType: "bearer", token: "REPLACE_WITH_BEARER_TOKEN" },
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", minLength: 1 },
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                product_id: { type: "string", minLength: 1 },
                quantity: { type: "integer", minimum: 1 },
              },
              required: ["product_id", "quantity"],
              additionalProperties: false,
            },
          },
          shipping_address: {
            type: "object",
            properties: {
              street: { type: "string", minLength: 1 },
              city: { type: "string", minLength: 1 },
              postal_code: { type: "string", minLength: 1 },
            },
            required: ["street", "city", "postal_code"],
            additionalProperties: false,
          },
          expedited: { type: "boolean", default: false },
        },
        required: ["customer_id", "items", "shipping_address"],
        additionalProperties: false,
      },
      visibility: "private",
    },
  },
  {
    id: "update_order_status",
    title: { zh: "修改订单", en: "Update an order" },
    purpose: {
      zh: "PATCH 将 order_id 替换到 URL 路径，只把 status 和可选 note 发送为 JSON body，使用 Basic 认证。",
      en: "PATCH substitutes order_id into the URL path and sends only status and the optional note as a JSON body, using Basic authentication.",
    },
    replace: {
      zh: "替换 url 的域名、auth.username 和 auth.password；按业务状态调整 status 枚举。省略 note 表示不提交该字段，与提交空字符串不同。",
      en: "Replace the URL host, auth.username and auth.password. Adapt the status enum to your workflow. Omitting note leaves it out of the request; this differs from sending an empty string.",
    },
    arguments: {
      order_id: "order-456",
      status: "confirmed",
      note: "Confirmed by customer",
    },
    tool: {
      name: "update_order_status",
      description:
        "修改订单状态和可选备注 / Change the order status and optional note",
      integration_type: "REST",
      request_type: "PATCH",
      url: "https://api.example.com/orders/{order_id}",
      auth: {
        authType: "basic",
        username: "REPLACE_WITH_USERNAME",
        password: "REPLACE_WITH_PASSWORD",
      },
      inputSchema: {
        type: "object",
        properties: {
          order_id: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["confirmed", "cancelled"] },
          note: { type: "string", maxLength: 500 },
        },
        required: ["order_id", "status"],
        additionalProperties: false,
      },
      visibility: "private",
    },
  },
];

export function isLocalRestTool(row) {
  return (
    (readField(row, "integration_type") || "REST") === "REST" &&
    !readField(row, "gateway_id") &&
    !readField(row, "grpc_service_id")
  );
}

export function restToolProblems(row, en = false) {
  const problems = [];
  const inputError = inputCompatibilityError(readField(row, "inputSchema"), en);
  if (inputError) problems.push(inputError);
  if (!isLocalRestTool(row))
    problems.push(
      en
        ? "Only local REST tools can be created here. Connect MCP services through MCP gateways; manage A2A tools through A2A agents."
        : "这里只能创建本地 REST 工具。MCP 工具请通过 MCP 网关接入；A2A 工具请通过 A2A 智能体管理。",
    );
  if (typeof row.url !== "string" || !row.url.trim())
    problems.push(en ? "Enter a REST endpoint URL." : "请填写 REST 端点 URL。");
  if (
    !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(
      readField(row, "request_type") || "POST",
    )
  )
    problems.push(
      en ? "Choose a REST HTTP request method." : "请选择 REST HTTP 请求方法。",
    );
  return problems;
}
