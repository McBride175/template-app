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
  tracePropagationTargets: [/^\//],
  integrations: [
    Sentry.breadcrumbsIntegration({
      console: false,
      dom: false,
    }),
  ],
  beforeBreadcrumb: scrubSentryBreadcrumb,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
