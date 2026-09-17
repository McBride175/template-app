export interface PrivacyControllerConfig {
  name: string | null
  email: string | null
  configured: boolean
}

export function getPrivacyControllerConfig(
  environment: NodeJS.ProcessEnv = process.env
): PrivacyControllerConfig {
  const name = environment.DATA_CONTROLLER_NAME?.trim() || null
  const email = environment.DATA_CONTROLLER_EMAIL?.trim() || null

  if (name && email) {
    return { name, email, configured: true }
  }

  if (environment.VERCEL_ENV === 'production') {
    const missing = [
      !name ? 'DATA_CONTROLLER_NAME' : null,
      !email ? 'DATA_CONTROLLER_EMAIL' : null,
    ].filter(Boolean)

    throw new Error(`${missing.join(' and ')} must be configured for Production`)
  }

  return { name: null, email: null, configured: false }
}
