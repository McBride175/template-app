import type { InputHTMLAttributes } from 'react'
import { fieldStyles } from './fieldStyles'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export default function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={fieldStyles(className)}
      {...props}
    />
  )
}
