import { ButtonHTMLAttributes, ReactNode } from 'react'
import { actionStyles, type ActionVariant, type ActionSize } from './actionStyles'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionVariant
  size?: ActionSize
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
      className={actionStyles({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  )
}
