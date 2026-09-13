export const AUTH_CAPTCHA_REQUIRED_MESSAGE =
  'Complete the security check before continuing.'

export function getTurnstileSiteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ''
}

export function getAuthCaptchaValidationError(siteKey: string, token: string | null) {
  if (!siteKey || token) return null
  return AUTH_CAPTCHA_REQUIRED_MESSAGE
}
