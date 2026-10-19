import { readField } from "./resource-model.mjs";

export const restToolTemplate = {
  name: "lookup_order",
  description: "根据订单编号查询订单 / Look up an order by its ID",
  integration_type: "REST",
  request_type: "POST",
  url: "https://api.example.com/orders/lookup",
  inputSchema: {
    type: "object",
    properties: {
      order_id: { type: "string", description: "订单编号 / Order ID" },
    },
    required: ["order_id"],
  },
  visibility: "private",
};

export function isLocalRestTool(row) {
  return (
    (readField(row, "integration_type") || "REST") === "REST" &&
    !readField(row, "gateway_id") &&
    !readField(row, "grpc_service_id")
  );
}

export function restToolProblems(row, en = false) {
  const problems = [];
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
