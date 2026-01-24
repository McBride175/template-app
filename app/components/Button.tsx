import { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        {
          // Primary variant
          'bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-950 focus-visible:ring-gray-900':
            variant === 'primary',
          // Secondary variant
          'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:ring-gray-900':
            variant === 'secondary',
          // Ghost variant
          'text-gray-700 hover:bg-gray-100 active:bg-gray-200 focus-visible:ring-gray-900':
            variant === 'ghost',
          // Sizes
          'text-sm px-3 py-1.5': size === 'sm',
          'text-sm px-4 py-2': size === 'md',
          'text-base px-6 py-3': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
