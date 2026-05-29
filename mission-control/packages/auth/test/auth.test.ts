import { describe, it, expect } from "vitest";
import { DevAuthProvider, can, roleCan, bearer } from "@mc/auth";

describe("roleCan / permission matrix", () => {
  it("viewer can read but not write", () => {
    expect(roleCan("viewer", "agents:read")).toBe(true);
    expect(roleCan("viewer", "agents:write")).toBe(false);
    expect(roleCan("viewer", "workflows:run")).toBe(false);
  });

  it("operator can run/approve and write conversations, but not author agents or workflows", () => {
    expect(roleCan("operator", "runs:approve")).toBe(true);
    expect(roleCan("operator", "workflows:run")).toBe(true);
    expect(roleCan("operator", "conversations:write")).toBe(true);
    expect(roleCan("operator", "agents:write")).toBe(false);
    expect(roleCan("operator", "workflows:write")).toBe(false);
  });

  it("owner/admin can do everything", () => {
    for (const p of ["agents:write", "workflows:write", "credentials:write", "runs:approve"] as const) {
      expect(roleCan("owner", p)).toBe(true);
      expect(roleCan("admin", p)).toBe(true);
    }
  });
});

describe("bearer", () => {
  it("parses a Bearer header", () => {
    expect(bearer("Bearer dev-owner")).toBe("dev-owner");
    expect(bearer("bearer  abc ")).toBe("abc");
    expect(bearer(undefined)).toBeUndefined();
    expect(bearer("Basic xyz")).toBeUndefined();
  });
});

describe("DevAuthProvider", () => {
  it("resolves known tokens and rejects unknown", async () => {
    const p = new DevAuthProvider("ws_default");
    const viewer = await p.authenticate("dev-viewer");
    expect(viewer?.role).toBe("viewer");
    expect(viewer?.workspaceId).toBe("ws_default");
    expect(await p.authenticate("nope")).toBeNull();
    expect(await p.authenticate(undefined)).toBeNull();
    expect(can(viewer!, "agents:read")).toBe(true);
    expect(can(viewer!, "agents:write")).toBe(false);
  });
});
