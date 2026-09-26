import type { ComponentProps } from 'react'
import { fieldStyles } from './fieldStyles'

export default function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={fieldStyles(className)} {...props} />
}
