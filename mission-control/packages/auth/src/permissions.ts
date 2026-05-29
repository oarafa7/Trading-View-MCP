/** Permission strings are `resource:action` (see docs/mission-control/13-security-deployment-scaling.md#rbac). */
export type Permission =
  | "agents:read"
  | "agents:write"
  | "conversations:read"
  | "conversations:write"
  | "runs:approve"
  | "workflows:read"
  | "workflows:run"
  | "workflows:write"
  | "knowledge:read"
  | "knowledge:write"
  | "connectors:read"
  | "usage:read"
  | "credentials:write";

export type RoleName = "owner" | "admin" | "operator" | "viewer";

const ALL: Permission[] = [
  "agents:read",
  "agents:write",
  "conversations:read",
  "conversations:write",
  "runs:approve",
  "workflows:read",
  "workflows:run",
  "workflows:write",
  "knowledge:read",
  "knowledge:write",
  "connectors:read",
  "usage:read",
  "credentials:write",
];

const READS: Permission[] = ALL.filter((p) => p.endsWith(":read"));

/** Default role → permission sets. Roles are per-workspace in the full model. */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  owner: ALL,
  admin: ALL,
  operator: [...READS, "conversations:write", "runs:approve", "workflows:run", "knowledge:write"],
  viewer: READS,
};

export function roleCan(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
