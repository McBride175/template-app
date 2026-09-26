import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Register utility names only; their values remain authoritative in theme.css.
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ['control', 'surface', 'surface-large'] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
