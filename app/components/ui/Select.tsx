import type { ComponentProps } from 'react'
import { fieldStyles } from './fieldStyles'

export default function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={fieldStyles(className)} {...props} />
}
