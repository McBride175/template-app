'use client'

import Script from 'next/script'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileWidgetId = string

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      theme: 'auto'
      size: 'flexible'
      appearance: 'interaction-only'
      callback: (token: string) => void
      'error-callback': () => void
      'expired-callback': () => void
      'timeout-callback': () => void
    }
  ): TurnstileWidgetId
  remove(widgetId: TurnstileWidgetId): void
  reset(widgetId: TurnstileWidgetId): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export type TurnstileCaptchaHandle = {
  reset: () => void
}

type TurnstileCaptchaProps = {
  action: 'public_auth' | 'signup' | 'password_recovery'
  disabled?: boolean
  onTokenChange: (token: string | null) => void
  siteKey: string
}

const TurnstileCaptcha = forwardRef<TurnstileCaptchaHandle, TurnstileCaptchaProps>(
  function TurnstileCaptcha({ action, disabled = false, onTokenChange, siteKey }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const widgetIdRef = useRef<TurnstileWidgetId | null>(null)
    const onTokenChangeRef = useRef(onTokenChange)
    const [loadError, setLoadError] = useState(false)
    const [scriptReady, setScriptReady] = useState(false)

    useEffect(() => {
      onTokenChangeRef.current = onTokenChange
    }, [onTokenChange])

    const reset = useCallback(() => {
      onTokenChangeRef.current(null)
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    }, [])

    useImperativeHandle(ref, () => ({ reset }), [reset])

    useEffect(() => {
      if (!scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) {
        return
      }

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          size: 'flexible',
          appearance: 'interaction-only',
          callback: (token) => {
            setLoadError(false)
            onTokenChangeRef.current(token)
          },
          'error-callback': () => {
            setLoadError(true)
            onTokenChangeRef.current(null)
          },
          'expired-callback': () => onTokenChangeRef.current(null),
          'timeout-callback': () => onTokenChangeRef.current(null),
        })
      } catch {
        queueMicrotask(() => {
          setLoadError(true)
          onTokenChangeRef.current(null)
        })
      }

      return () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current)
        }
        widgetIdRef.current = null
      }
    }, [action, scriptReady, siteKey])

    return (
      <div className="space-y-2" aria-disabled={disabled}>
        <Script
          id="cloudflare-turnstile-script"
          src={TURNSTILE_SCRIPT_URL}
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => {
            setLoadError(true)
            onTokenChangeRef.current(null)
          }}
        />
        <div
          ref={containerRef}
          className={disabled ? 'pointer-events-none opacity-60' : undefined}
        />
        {loadError && (
          <p className="text-sm text-red-700" role="alert">
            The security check could not load. Check your connection and try again.
          </p>
        )}
      </div>
    )
  }
)

export default TurnstileCaptcha
