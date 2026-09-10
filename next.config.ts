import type { NextConfig } from "next";

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

export default nextConfig;
