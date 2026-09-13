import type { Breadcrumb, Event } from '@sentry/nextjs'

const FILTERED = '[Filtered]'

const sensitiveKeyPattern = /(?:^|[._-])(?:authorization|cookie|password|passwd|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|service[._-]?role|session|stripe[._-]?key|xero[._-]?token)(?:$|[._-])/i

const sensitiveValuePatterns: Array<[RegExp, string]> = [
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]+\b/g, FILTERED],
  [/\bwhsec_[A-Za-z0-9]+\b/g, FILTERED],
  [/\bsntrys_[A-Za-z0-9_+/=-]+/g, FILTERED],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, FILTERED],
  [/\b(Bearer\s+)[^\s,;]+/gi, `$1${FILTERED}`],
  [
    /((?:authorization|cookie|password|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*["']?)[^"',\s}]+/gi,
    `$1${FILTERED}`,
  ],
]

export const sentryEnvironment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || 'local'

export const sentryEnabled = sentryEnvironment !== 'local'

export const sentryTraceSampleRate = sentryEnvironment === 'production' ? 0.02 : 0.1

export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: false,
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: {
    document: false,
    variables: false,
  },
  genAI: {
    inputs: false,
    outputs: false,
  },
  databaseQueryData: false,
  stackFrameVariables: false,
}

function stripUrlQuery(value: string) {
  const queryIndex = value.search(/[?#]/)
  return queryIndex === -1 ? value : value.slice(0, queryIndex)
}

function redactText(value: string) {
  return sensitiveValuePatterns.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value
  )
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return FILTERED
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKeyPattern.test(key) ? FILTERED : scrubValue(nestedValue, depth + 1),
    ])
  )
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console' || breadcrumb.category === 'ui.click') {
    return null
  }

  if (breadcrumb.message) {
    breadcrumb.message = redactText(stripUrlQuery(breadcrumb.message))
  }

  if (breadcrumb.data) {
    breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>

    for (const key of ['url', 'from', 'to']) {
      const value = breadcrumb.data[key]
      if (typeof value === 'string') breadcrumb.data[key] = stripUrlQuery(value)
    }
  }

  return breadcrumb
}

export function scrubSentryEvent<T extends Event>(event: T): T {
  event.user = undefined

  if (event.request) {
    event.request.headers = undefined
    event.request.cookies = undefined
    event.request.data = undefined
    event.request.env = undefined
    event.request.query_string = undefined
    if (event.request.url) event.request.url = stripUrlQuery(event.request.url)
  }

  if (event.message) event.message = redactText(event.message)
  if (event.transaction) event.transaction = stripUrlQuery(event.transaction)

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value)
  }

  event.extra = scrubValue(event.extra) as Event['extra']
  event.contexts = scrubValue(event.contexts) as Event['contexts']
  event.tags = scrubValue(event.tags) as Event['tags']

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubSentryBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
  }

  for (const span of event.spans ?? []) {
    if (span.description) {
      span.description = span.op?.startsWith('db')
        ? span.op
        : redactText(stripUrlQuery(span.description))
    }
    span.data = scrubValue(span.data) as typeof span.data
  }

  return event
}
