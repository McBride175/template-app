import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs/config'

const noIndexHeader = {
  key: 'X-Robots-Tag',
  value: 'noindex, nofollow',
}

const productionNoIndexRoutes = [
  '/account/:path*',
  '/admin/:path*',
  '/api/:path*',
  '/auth/:path*',
  '/collections/:path*',
  '/customers/:path*',
  '/dashboard/:path*',
  '/disputes/:path*',
  '/login/:path*',
  '/reset-password/:path*',
  '/settings/:path*',
  '/signup/:path*',
  '/xero/:path*',
]

const nextConfig: NextConfig = {
  async headers() {
    if (process.env.VERCEL_ENV !== 'production') {
      return [
        {
          source: '/:path*',
          headers: [noIndexHeader],
        },
      ]
    }

    return productionNoIndexRoutes.map((source) => ({
      source,
      headers: [noIndexHeader],
    }))
  },
};

const hasSentryBuildCredentials = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
)

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !hasSentryBuildCredentials,
    deleteSourcemapsAfterUpload: true,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
})
