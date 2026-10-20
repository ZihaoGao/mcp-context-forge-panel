/** v1.0.11 tool writes consume flat credentials before model validation. */
export function toolAuthenticationProblems(auth, en = false) {
  if (!auth || !Object.keys(auth).length) return [];
  const t = (zh, english) => (en ? english : zh);
  const type = auth.authType ?? auth.auth_type;
  if (type === "none") return [];
  // Keep the explicitly encoded API input supported; the resource editor never
  // prefills this value from GET and never computes backend encryption itself.
  if (auth.authValue || auth.auth_value) return [];
  const errors = [];
  const need = (key) => {
    if (typeof auth[key] !== "string" || !auth[key].length)
      errors.push(t(`认证 ${key}：必填`, `Authentication ${key}: required`));
  };
  if (type === "basic") {
    need("username");
    need("password");
  } else if (type === "bearer") need("token");
  else if (type === "authheaders") {
    const rows = auth.authHeaders;
    if (Array.isArray(rows) && rows.length) {
      if (rows.length > 100)
        errors.push(
          t(
            "认证请求头最多 100 项",
            "At most 100 authentication headers are allowed",
          ),
        );
      for (const [index, row] of rows.entries()) {
        if (
          !row ||
          typeof row.key !== "string" ||
          !/^[A-Za-z0-9_-]+$/.test(row.key.trim()) ||
          typeof row.value !== "string" ||
          !row.value.length
        )
          errors.push(
            t(
              `认证请求头第 ${index + 1} 项需要合法的 key 和非空 value`,
              `Authentication header ${index + 1} requires a valid key and nonempty value`,
            ),
          );
      }
    } else {
      need("authHeaderKey");
      need("authHeaderValue");
      if (
        typeof auth.authHeaderKey === "string" &&
        auth.authHeaderKey &&
        !/^[A-Za-z0-9_-]+$/.test(auth.authHeaderKey.trim())
      )
        errors.push(
          t("认证请求头名称无效", "Invalid authentication header name"),
        );
    }
  } else
    errors.push(t("请选择工具认证方式", "Select a tool authentication method"));
  return errors;
}

export function toolWriteRecord(record, en = false) {
  if (!record?.auth || typeof record.auth !== "object") return record;
  const errors = toolAuthenticationProblems(record.auth, en);
  if (errors.length) throw new Error(errors.join("\n"));
  const { auth, ...out } = record;
  const type = auth.authType ?? auth.auth_type;
  if (!type) return out;
  if (type === "none")
    return { ...out, auth: { authType: "none", authValue: "" } };
  if (auth.authValue || auth.auth_value) return record;
  if (type === "basic")
    return {
      ...out,
      auth_type: type,
      auth_username: auth.username,
      auth_password: auth.password,
    };
  if (type === "bearer")
    return { ...out, auth_type: type, auth_token: auth.token };
  return {
    ...out,
    auth_type: type,
    auth_headers: auth.authHeaders?.length
      ? auth.authHeaders.map(({ key, value }) => ({ key: key.trim(), value }))
      : [{ key: auth.authHeaderKey.trim(), value: auth.authHeaderValue }],
  };
}

export function toolWriteBody(body, en = false) {
  return body?.tool
    ? { ...body, tool: toolWriteRecord(body.tool, en) }
    : toolWriteRecord(body, en);
}

/** Only non-secret context is retained from the full GET record for edits. */
export function toolEditContext(record) {
  return {
    teamId: record.teamId ?? record.team_id ?? "",
    teamName: record.team?.name ?? "",
    authType: record.auth?.authType ?? record.auth?.auth_type ?? "none",
  };
}
