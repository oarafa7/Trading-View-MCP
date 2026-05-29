import { randomUUID } from "node:crypto";

/** Prefixed, sortable-enough ids. (Swap for ULID when ordering guarantees matter.) */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
