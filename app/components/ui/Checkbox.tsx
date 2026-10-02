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
        'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:accent-text-disabled disabled:opacity-75',
        className
      )}
    />
  )
}
