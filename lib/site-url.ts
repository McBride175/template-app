const LOCAL_SITE_URL = 'http://localhost:3000'

function normalizeSiteUrl(raw: string) {
  const url = new URL(raw)

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('NEXT_PUBLIC_SITE_URL must use http or https')
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an origin without credentials, a path, query, or fragment')
  }

  return url.origin
}

export function getSiteUrl(environment: NodeJS.ProcessEnv = process.env) {
  const configuredSiteUrl = environment.NEXT_PUBLIC_SITE_URL?.trim()

  if (configuredSiteUrl) {
    const siteUrl = normalizeSiteUrl(configuredSiteUrl)
    if (environment.VERCEL_ENV === 'production' && !siteUrl.startsWith('https://')) {
      throw new Error('NEXT_PUBLIC_SITE_URL must use https in Production')
    }
    return siteUrl
  }

  if (environment.VERCEL_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL must be configured for Production')
  }

  return LOCAL_SITE_URL
}
