// Match the method and complete route, including nested resource operations.
// Parameter names vary between schemas; their positions define the operation.
const names = {
  "GET /v1/teams/{}/members": ["查看成员", "View members"],
  "POST /v1/teams/{}/members": ["添加成员", "Add member"],
  "PUT /v1/teams/{}/members/{}": ["修改成员角色", "Change member role"],
  "DELETE /v1/teams/{}/members/{}": ["移除成员", "Remove member"],
  "GET /v1/teams/{}/invitations": ["查看邀请", "View invitations"],
  "POST /v1/teams/{}/invitations": ["发送团队邀请", "Send team invitation"],
  "DELETE /v1/teams/invitations/{}": ["撤销团队邀请", "Cancel team invitation"],
  "POST /v1/teams/invitations/{}/accept": [
    "接受团队邀请",
    "Accept team invitation",
  ],
  "POST /v1/teams/{}/join": ["申请加入团队", "Request to join team"],
  "DELETE /v1/teams/{}/leave": ["退出团队", "Leave team"],
  "GET /v1/teams/{}/join-requests": ["查看加入申请", "View join requests"],
  "POST /v1/teams/{}/join-requests/{}/approve": [
    "批准加入申请",
    "Approve join request",
  ],
  "DELETE /v1/teams/{}/join-requests/{}": [
    "拒绝加入申请",
    "Reject join request",
  ],
  "GET /v1/gateways/{}/impact-preview": [
    "预览网关影响范围",
    "Preview gateway impact",
  ],
  "POST /v1/gateways/{}/tools/refresh": ["重新发现工具", "Rediscover tools"],
  "POST /v1/servers/{}/test-handshake": ["测试 MCP 握手", "Test MCP handshake"],
  "GET /v1/servers/{}/tools": ["查看关联工具", "View associated tools"],
  "GET /v1/servers/{}/resources": ["查看关联资源", "View associated resources"],
  "GET /v1/servers/{}/prompts": ["查看关联提示词", "View associated prompts"],
  "GET /v1/resources/{}/info": ["查看资源信息", "View resource information"],
  "POST /v1/prompts/{}": ["预览提示词", "Render prompt"],
  "POST /v1/a2a/{}/invoke": ["调用智能体", "Invoke agent"],
  "POST /v1/a2a/{}/jsonrpc": ["发送 JSON-RPC 请求", "Send JSON-RPC request"],
  "POST /v1/auth/email/admin/users/{}/unlock": ["解锁账户", "Unlock account"],
  "GET /v1/tokens/{}/usage": ["查看 Key 用量", "View key usage"],
  "POST /v1/llm/providers/{}/health": [
    "检查供应商健康状态",
    "Check provider health",
  ],
  "POST /v1/catalog/{}/register": ["注册服务", "Register service"],
  "GET /v1/rbac/users/{}/roles": ["查看角色分配", "View role assignments"],
  "POST /v1/rbac/users/{}/roles": ["分配角色", "Assign role"],
  "DELETE /v1/rbac/users/{}/roles/{}": [
    "撤销角色分配",
    "Revoke role assignment",
  ],
};

export function actionRoute(op) {
  return `${op.method.toUpperCase()} ${op.path.replace(/\/$/, "").replace(/\{[^}]+\}/g, "{}")}`;
}

export function resourceActionName(op, noun, en = false) {
  const route = actionRoute(op);
  const known = names[route];
  if (known) return known[en ? 1 : 0];
  if (
    /^POST \/v1\/(tools|resources|prompts|gateways|servers|a2a|llm\/providers)\/\{\}\/state$/.test(
      route,
    )
  )
    return en ? "Change enabled state" : "更改启用状态";
  if (
    /^POST \/v1\/(tools|resources|prompts|gateways|servers|a2a)\/\{\}\/toggle$/.test(
      route,
    )
  )
    return en ? "Toggle enabled state" : "切换启用状态";
  const path = op.path.replace(/\/$/, "");
  if (
    /^\/v1\/(tools|resources|prompts|gateways|servers|a2a|teams|tokens|roots|rbac\/roles|llm\/providers|admin\/plugins|auth\/email\/admin\/users)\/\{[^}]+\}$/.test(
      path,
    )
  ) {
    if (op.method === "GET") return en ? `View ${noun}` : `${noun}详情`;
    if (["PUT", "PATCH"].includes(op.method))
      return en ? `Edit ${noun}` : `编辑${noun}`;
    if (op.method === "DELETE")
      return noun === "API Key"
        ? en
          ? "Revoke API Key"
          : "撤销 API Key"
        : en
          ? `Delete ${noun}`
          : `删除${noun}`;
  }
  // Unknown routes keep a visible method/path instead of guessing a destructive
  // operation or exposing an English API summary as a Chinese action name.
  return `${en ? "Operation" : "执行操作"} · ${op.method} ${path}`;
}
