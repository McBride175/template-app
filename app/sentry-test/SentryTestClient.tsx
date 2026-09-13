'use client'

export default function SentryTestClient() {
  return (
    <button
      type="button"
      className="rounded bg-red-700 px-4 py-2 font-medium text-white"
      onClick={() => {
        throw new Error('Sentry client verification 2026-09-13')
      }}
    >
      Trigger temporary client error
    </button>
  )
}
