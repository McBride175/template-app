'use client'

import { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AuthSocialButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  label: string
}

export default function AuthSocialButton({
  icon,
  label,
  className,
  ...props
}: AuthSocialButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-gray-300 bg-white px-5 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-60',
        className
      )}
      {...props}
    >
      <span className="inline-flex h-6 w-6 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
