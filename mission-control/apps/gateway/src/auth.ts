import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DevAuthProvider, bearer, can, type Principal, type Permission } from "@mc/auth";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "true";

/**
 * Resolve a Principal for every request from the `Authorization: Bearer <token>` header.
 * In dev (AUTH_REQUIRED unset) an absent/unknown token falls back to an owner principal so the
 * zero-config demo keeps working; a valid lower-privilege token (e.g. `dev-viewer`) is honored so
 * RBAC is demonstrable. With AUTH_REQUIRED=true, a missing/invalid token is rejected (401).
 */
export function installAuth(app: FastifyInstance, workspaceId: string): void {
  const provider = new DevAuthProvider(workspaceId);
  const ownerDefault: Principal = { userId: "user_dev", workspaceId, role: "owner", name: "Dev (default)" };

  app.decorateRequest("principal", null as unknown as Principal);

  app.addHook("preHandler", async (req, reply) => {
    const token = bearer(req.headers["authorization"]);
    const principal = await provider.authenticate(token);
    if (!principal) {
      if (AUTH_REQUIRED) {
        await reply.code(401).send({ code: "UNAUTHORIZED", message: "valid bearer token required" });
        return reply;
      }
      req.principal = ownerDefault;
      return;
    }
    req.principal = principal;
  });
}

/** Guard a route by permission. Returns false (and sends 403) when the caller lacks it. */
export function requirePerm(req: FastifyRequest, reply: FastifyReply, permission: Permission): boolean {
  if (can(req.principal, permission)) return true;
  reply.code(403).send({ code: "FORBIDDEN", message: `requires "${permission}" (role: ${req.principal.role})` });
  return false;
}
