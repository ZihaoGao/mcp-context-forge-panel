export const englishProfiles = {
  servers: [
    "virtual server",
    "Name the server and select the tools, resources, prompts and agents available to MCP clients.",
  ],
  gateways: [
    "MCP gateway",
    "Enter the upstream MCP address and transport. Saving connects to the upstream and discovers tools.",
  ],
  tools: [
    "tool",
    "Register a callable endpoint. To connect a complete MCP service, use MCP gateways.",
  ],
  resources: [
    "resource",
    "Provide content clients can read. Use a unique URI such as context://handbook.",
  ],
  prompts: ["prompt", "Write a reusable template and define its arguments."],
  a2a: [
    "A2A agent",
    "Connect an A2A agent using its endpoint, protocol and authentication settings.",
  ],
  roots: ["root", "Register a root URI available to MCP clients."],
  tokens: [
    "API Key",
    "Create an application credential and choose its access scope and expiry.",
  ],
  teams: ["team", "Manage the team, members, invitations and join requests."],
  users: ["user", "Manage user accounts, their state and security settings."],
  rbac: ["role", "Define the role scope, permissions and inheritance."],
  llm: ["model provider", "Configure a model provider and its default model."],
  plugins: [
    "plugin",
    "View installed plugins and configure their runtime mode.",
  ],
  catalog: ["catalog service", "Choose a catalog service to register."],
};

const labels = {
  name: "Name",
  description: "Description",
  visibility: "Visibility",
  team_id: "Team",
  scope_id: "Applicable team",
  server_id: "Restrict to virtual server",
  scope: "Access scope",
  activate: "Enabled state",
  purge_metrics: "Delete historical metrics",
  mode: "Plugin mode",
  auth_username: "Authentication username",
  auth_password: "Authentication password",
  auth_token: "Access token",
  auth_header_key: "Authentication header name",
  auth_header_value: "Authentication header value",
  auth_query_param_key: "Authentication query parameter",
  auth_query_param_value: "Authentication query value",
  auth_type: "Authentication method",
  oauth_config: "OAuth configuration",
  oauth_credentials: "OAuth credentials",
  time_restrictions: "Allowed time windows",
  usage_limits: "Usage limits",
  expires_at: "Expires at",
  permissions: "Permissions",
  expires_in_days: "Validity in days",
  url: "Endpoint",
  endpoint_url: "Agent endpoint",
  transport: "Transport",
  associated_tools: "Provided tools",
  associated_resources: "Provided resources",
  associated_prompts: "Provided prompts",
  associated_a2a_agents: "Provided agents",
  uri: "Resource URI",
  content: "Resource content",
  mime_type: "Content type",
  template: "Template",
  arguments: "Template arguments",
  input_schema: "Input schema",
  output_schema: "Output schema",
  request_type: "Request method",
  integration_type: "Integration type",
  email: "Email",
  full_name: "Display name",
  password: "Initial password",
  password_change_required: "Require password change on first login",
  is_admin: "Platform administrator",
  is_active: "Account / key state",
  enabled: "Enabled",
  slug: "Team slug",
  max_members: "Member limit",
  members: "Initial members",
  inherits_from: "Parent role",
  role_id: "Role",
  user_email: "User email",
  api_base: "API base URL",
  api_key: "API Key",
  provider_type: "Provider type",
  api_version: "API version",
  default_model: "Default model",
  tags: "Tags",
  ip_restrictions: "Allowed source IPs",
  plugin_ids: "Plugins",
};
export function canonicalField(key) {
  return key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
}
export function englishFieldLabel(key, fallback) {
  return labels[canonicalField(key)] || fallback || key;
}

export const associationHelp = {
  associated_tools: [
    "搜索并选择客户端可调用的工具；不选择则不提供工具。",
    "Search and select tools available to clients. Clear the selection to provide no tools.",
  ],
  associated_resources: [
    "选择客户端可读取的资源。",
    "Select resources clients can read.",
  ],
  associated_prompts: [
    "选择客户端可使用的提示词模板。",
    "Select prompt templates clients can use.",
  ],
  associated_a2a_agents: [
    "选择需要通过此服务器提供的 A2A 智能体。",
    "Select A2A agents available through this server.",
  ],
  plugin_ids: ["搜索并选择插件。", "Search and select plugins."],
};
