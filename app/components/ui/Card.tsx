import { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'subtle'
  children: ReactNode
}

export default function Card({ variant = 'default', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'border border-border-default text-text-primary font-sans rounded-surface p-4 shadow-surface',
        variant === 'subtle' ? 'bg-surface-subtle' : 'bg-surface',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
