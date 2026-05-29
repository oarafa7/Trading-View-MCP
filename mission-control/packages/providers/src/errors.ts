import type { ErrorCode, ProviderError } from "@mc/types";

/** Map an HTTP status from any provider into the shared error taxonomy. */
export function codeFromStatus(status: number): { code: ErrorCode; retryable: boolean } {
  if (status === 401 || status === 403) return { code: "AUTH", retryable: false };
  if (status === 400 || status === 422) return { code: "BAD_REQUEST", retryable: false };
  if (status === 408) return { code: "TIMEOUT", retryable: true };
  if (status === 429) return { code: "RATE_LIMIT", retryable: true };
  if (status >= 500) return { code: "PROVIDER_UNAVAILABLE", retryable: true };
  return { code: "UNKNOWN", retryable: false };
}

export function providerError(
  provider: string,
  message: string,
  opts: { status?: number; code?: ErrorCode; retryable?: boolean } = {},
): ProviderError {
  const mapped = opts.status !== undefined ? codeFromStatus(opts.status) : undefined;
  return {
    provider,
    message,
    status: opts.status,
    code: opts.code ?? mapped?.code ?? "UNKNOWN",
    retryable: opts.retryable ?? mapped?.retryable ?? false,
  };
}

export class ProviderCallError extends Error {
  readonly providerError: ProviderError;
  constructor(err: ProviderError) {
    super(err.message);
    this.name = "ProviderCallError";
    this.providerError = err;
  }
}
