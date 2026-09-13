import * as Sentry from '@sentry/nextjs'
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  sentryDataCollection,
  sentryEnabled,
  sentryEnvironment,
  sentryTraceSampleRate,
} from '@/lib/sentry-config'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: sentryEnabled && Boolean(dsn),
  environment: sentryEnvironment,
  sendDefaultPii: false,
  dataCollection: sentryDataCollection,
  tracesSampleRate: sentryTraceSampleRate,
  beforeBreadcrumb: scrubSentryBreadcrumb,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
})
