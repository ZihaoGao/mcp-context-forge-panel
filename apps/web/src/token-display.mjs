export function tokenState(token) {
  if (token.is_revoked === true) return "revoked";
  return token.is_active === false ? "disabled" : "available";
}

export function mergeTokenRevocation(listItem, detail) {
  if (
    listItem?.is_revoked !== true ||
    !detail ||
    (listItem.id && detail.id && listItem.id !== detail.id)
  )
    return detail;
  // v1.0.11 detail responses default revocation fields to false/null. Preserve
  // known list evidence for display without modifying the raw GET response.
  return {
    ...detail,
    is_revoked: true,
    ...Object.fromEntries(
      ["revoked_at", "revoked_by", "revocation_reason"].map((key) => [
        key,
        detail[key] ?? listItem[key] ?? null,
      ]),
    ),
  };
}
