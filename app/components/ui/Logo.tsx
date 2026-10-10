import Image from 'next/image'
import { cn } from '@/lib/utils'

type PrincipalVariant = 'horizontal' | 'stacked'
type IconVariant = 'square' | 'micro'
type Colour = 'brand' | 'monochrome' | 'white'

type LogoProps = {
  /** Width of the original SVG canvas, before the external clear space. */
  width?: number
  className?: string
  decorative?: boolean
  label?: string
} & (
  | { variant?: PrincipalVariant; colour?: Colour }
  | { variant: IconVariant; colour?: 'brand' }
)

// Intrinsic artwork measurements, not UI/theme tokens. Keep the full y descent.
const principal = {
  horizontal: {
    width: 292, height: 90, defaultWidth: 160,
    ink: { x: 11.25, y: 9.01, width: 259.704, height: 69.43 },
  },
  stacked: {
    width: 146.329153686, height: 146, defaultWidth: 96,
    ink: { x: 10, y: 9.872, width: 126.329153686, height: 126.039 },
  },
} as const

const assets = {
  horizontal: {
    brand: '/brand/logo-horizontal.svg',
    monochrome: '/brand/logo-horizontal-monochrome.svg',
    white: '/brand/logo-horizontal-white.svg',
  },
  stacked: {
    brand: '/brand/logo-stacked.svg',
    monochrome: '/brand/logo-stacked-monochrome.svg',
    white: '/brand/logo-stacked-white.svg',
  },
  square: '/brand/logo-square.svg',
  micro: '/brand/mark-yo.svg',
} as const

/** Approved artwork with reserved dimensions and the guide's external clear space. */
export default function Logo({
  variant = 'horizontal',
  colour = 'brand',
  width,
  className,
  decorative = false,
  label = 'Yuohme',
}: LogoProps) {
  const isPrincipal = variant === 'horizontal' || variant === 'stacked'
  const drawing = isPrincipal ? principal[variant] : null
  const canvasWidth = drawing?.width ?? 512
  const canvasHeight = drawing?.height ?? 512
  const displayWidth = width ?? drawing?.defaultWidth ?? (variant === 'micro' ? 40 : 64)
  if (!Number.isFinite(displayWidth) || displayWidth <= 0) {
    throw new RangeError('Logo width must be a finite positive number')
  }

  const scale = displayWidth / canvasWidth
  const displayHeight = canvasHeight * scale
  // The SVG's own transparent margins supply part of one o-body-height (39.9).
  const padding = drawing ? {
    paddingTop: Math.max(0, 39.9 - drawing.ink.y) * scale,
    paddingRight: Math.max(0, 39.9 - (canvasWidth - drawing.ink.x - drawing.ink.width)) * scale,
    paddingBottom: Math.max(0, 39.9 - (canvasHeight - drawing.ink.y - drawing.ink.height)) * scale,
    paddingLeft: Math.max(0, 39.9 - drawing.ink.x) * scale,
  } : undefined
  const src = isPrincipal ? assets[variant][colour] : assets[variant]

  return (
    <span
      className={cn('inline-flex shrink-0 align-middle', className)}
      style={padding}
      aria-hidden={decorative ? true : undefined}
    >
      <Image
        src={src}
        alt={decorative ? '' : label}
        width={Math.ceil(canvasWidth)}
        height={Math.ceil(canvasHeight)}
        unoptimized
        loading="eager"
        className="block max-w-none"
        style={{ width: displayWidth, height: displayHeight }}
      />
    </span>
  )
}
