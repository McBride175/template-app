'use client'

import { ButtonHTMLAttributes, ReactNode } from 'react'
import { actionStyles } from './ui/actionStyles'

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
      className={actionStyles({
        variant: 'secondary',
        size: 'lg',
        className: `min-h-14 w-full gap-3 px-5 font-semibold ${className ?? ''}`,
      })}
      {...props}
    >
      <span className="inline-flex h-6 w-6 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
