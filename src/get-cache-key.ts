// Query-string flags that force a cache bypass. Callers pass ?bust=true
// (or any alias) to skip the cache match AND to warm the canonical
// (no-params) cache entry with the fresh response. See index.ts for the
// matching read/write side of this.
export const BYPASS_KEYS = ["bust", "refresh", "noCache", "nocache"];

/**
 * Build the cache key for this request. Returns `null` to indicate
 * "do not cache" (e.g. `Pragma: no-cache` header).
 *
 * Strips any `BYPASS_KEYS` query params from the URL before returning,
 * so that a `?bust=true` request writes its fresh response under the
 * SAME key as the bare URL — next bare-URL visitor hits fresh cache.
 */
export function getCacheKey(request: Request): string | null {
  const pragma = request.headers.get("pragma");
  if (pragma === "no-cache") {
    return null;
  }

  const cacheControl = request.headers.get("cache-control");
  if (cacheControl) {
    const directives = new Set(cacheControl.split(",").map((s) => s.trim()));
    if (directives.has("no-store") || directives.has("no-cache")) {
      return null;
    }
  }

  // Strip bypass params so `?bust=true` shares a cache key with the bare URL.
  const url = new URL(request.url);
  let stripped = false;
  for (const k of BYPASS_KEYS) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      stripped = true;
    }
  }
  // Also strip `_cb` — commonly used by clients as a unique timestamp
  // cache-buster; we want all `?_cb=123`, `?_cb=456` requests to share
  // one cache entry rather than each one populating its own.
  if (url.searchParams.has("_cb")) {
    url.searchParams.delete("_cb");
    stripped = true;
  }
  return stripped ? url.toString() : request.url;
}

/** Does this request ask us to bypass the cache on read? */
export function isCacheBypass(request: Request): boolean {
  const url = new URL(request.url);
  return BYPASS_KEYS.some((k) => url.searchParams.has(k));
}
