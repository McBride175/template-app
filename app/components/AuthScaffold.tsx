'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

interface AuthScaffoldProps {
  title: string
  switchLabel: string
  switchHref: string
  switchText: string
  socialActions: ReactNode
  children: ReactNode
  helperText: ReactNode
  error?: string | null
  status?: string | null
}

export default function AuthScaffold({
  title,
  switchLabel,
  switchHref,
  switchText,
  socialActions,
  children,
  helperText,
  error,
  status,
}: AuthScaffoldProps) {
  return (
    <div className="min-h-[calc(100vh-10rem)] py-8 sm:py-12">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 text-lg text-gray-600">
            {switchLabel}{' '}
            <Link href={switchHref} className="font-semibold text-gray-900 hover:underline">
              {switchText}
            </Link>
          </p>
        </header>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">{socialActions}</div>

        <div className="my-8 flex items-center gap-4">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-sm font-medium uppercase tracking-wide text-gray-500">or</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <div className="space-y-6">{children}</div>

        {(error || status) && (
          <p className={`mt-5 text-sm ${error ? 'text-red-600' : 'text-green-700'}`}>
            {error ?? status}
          </p>
        )}

        <div className="mt-8 text-center text-sm text-gray-600">{helperText}</div>
      </section>
    </div>
  )
}
