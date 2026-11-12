/**
 * Whether a role may read the audit log: owners and admins, as on the API's
 * `/v1/audit`. Better Auth keeps several roles as "admin,member".
 */
export function seesAudit(role: string | undefined) {
  return (role ?? "").split(",").some((one) => ["owner", "admin"].includes(one.trim()));
}
