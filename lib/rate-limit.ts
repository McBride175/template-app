type RateLimitEntry = {
  count: number
  windowStart: number
}

const store = new Map<string, RateLimitEntry>()

export function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const existing = store.get(key)

  if (!existing || now - existing.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1 }
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0 }
  }

  existing.count += 1
  store.set(key, existing)

  return { allowed: true, remaining: Math.max(0, limit - existing.count) }
}
