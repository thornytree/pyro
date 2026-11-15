export type SourceName = "Open-Meteo" | "FIRMS" | "Daymet" | "USGS 3DEP" | "LANDFIRE";
export type FailureReason = "AUTHENTICATION_FAILED" | "NOT_FOUND" | "RATE_LIMITED" | "TIMEOUT" | "INVALID_RESPONSE" | "REQUEST_FAILED";

/** Public diagnostics use fixed messages, never raw provider URLs, headers or tokens. */
export class SourceFetchError extends Error {
  readonly reason: FailureReason;
  readonly upstreamStatus: number | undefined;

  constructor(readonly source: SourceName, cause: unknown) {
    const errors: Error[] = [];
    let current = cause;
    while (current instanceof Error && errors.length < 5 && !errors.includes(current)) {
      errors.push(current);
      current = current.cause;
    }
    const text = errors.map(error => error.message).join("\n");
    const statusMatch = /\bHTTP\s+(\d{3})\b/i.exec(text);
    const status = statusMatch ? Number(statusMatch[1]) : undefined;
    let reason: FailureReason = "REQUEST_FAILED";
    let explanation = "The provider request failed. Check connectivity and source availability.";
    if (status === 401 || status === 403 || /requires authorized NASA Earthdata access/i.test(text)) {
      reason = "AUTHENTICATION_FAILED";
      explanation = source === "Daymet"
        ? "NASA Earthdata rejected access. Check EARTHDATA_TOKEN and authorization for the Daymet service."
        : "The provider rejected access. Check its server-side credentials.";
    } else if (status === 404) {
      reason = "NOT_FOUND";
      explanation = "The requested dataset or endpoint was not found. Check source availability and dates.";
    } else if (status === 429 || /rate limit|request limit|too many requests/i.test(text)) {
      reason = "RATE_LIMITED";
      explanation = "The provider rate limit was reached. Retry later.";
    } else if (errors.some(error => error.name.endsWith("TimeoutError"))) {
      reason = "TIMEOUT";
      explanation = "The provider request timed out.";
    } else if (/invalid|missing|incomplete|unsupported|no usable data|no cells|no days/i.test(text)) {
      reason = "INVALID_RESPONSE";
      explanation = "The provider returned unusable data. Check coverage, requested dates and response format.";
    }
    super(`${source} failed${status ? ` (HTTP ${status})` : ""}: ${explanation}`, { cause });
    this.name = "SourceFetchError";
    this.reason = reason;
    this.upstreamStatus = status;
  }
}

export async function fetchSource<T>(source: SourceName, fetcher: () => Promise<T>): Promise<T> {
  try { return await fetcher(); }
  catch (error) { throw new SourceFetchError(source, error); }
}
