import type { RoleName, Permission } from "./permissions.js";
import { roleCan } from "./permissions.js";

export interface Principal {
  userId: string;
  workspaceId: string;
  role: RoleName;
  name: string;
}

/** Pluggable authentication. Swap DevAuthProvider for a ClerkAuthProvider in production. */
export interface AuthProvider {
  /** Resolve a bearer token to a principal, or null if unauthenticated. */
  authenticate(token: string | undefined): Promise<Principal | null>;
}

export function can(principal: Principal, permission: Permission): boolean {
  return roleCan(principal.role, permission);
}

/**
 * Token-based dev auth: maps `dev-<role>` tokens to principals in the default workspace.
 * No external service — lets RBAC be exercised end-to-end offline. ClerkAuthProvider would
 * verify a Clerk session JWT and map Clerk org roles to RoleName instead.
 */
export class DevAuthProvider implements AuthProvider {
  private tokens: Map<string, Principal>;

  constructor(workspaceId: string) {
    const mk = (role: RoleName): Principal => ({ userId: `user_${role}`, workspaceId, role, name: `Dev ${role}` });
    this.tokens = new Map([
      ["dev-owner", mk("owner")],
      ["dev-admin", mk("admin")],
      ["dev-operator", mk("operator")],
      ["dev-viewer", mk("viewer")],
    ]);
  }

  async authenticate(token: string | undefined): Promise<Principal | null> {
    if (!token) return null;
    return this.tokens.get(token) ?? null;
  }
}

/** Extract a bearer token from an Authorization header value. */
export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1]?.trim();
}
