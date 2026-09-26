import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>

// Browser-native check mark, state and keyboard behaviour; labels belong to callers.
export default function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn(
        'h-4 w-4 shrink-0 accent-action-primary cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    />
  )
}
