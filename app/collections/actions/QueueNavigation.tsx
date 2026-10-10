import Button from '@/app/components/ui/Button'

/** Focus the newly selected priority, scrolling only when it is outside useful view. */
export function revealPriority(element: HTMLElement | null) {
  if (!element) return
  element.focus({ preventScroll: true })
  const top = element.getBoundingClientRect().top
  if (top < 0 || top > window.innerHeight / 2) element.scrollIntoView?.({
    block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
}

export default function QueueNavigation({ index, count, disabled, onPrevious, onNext, onFirst }: {
  index: number; count: number; disabled: boolean
  onPrevious: () => void; onNext: () => void; onFirst: () => void
}) {
  return <div className="flex flex-wrap gap-2" aria-label="Queue navigation" role="group">
    {index > 0 && count > 0 && <Button variant="ghost" size="sm" className="min-h-11" disabled={disabled} onClick={onFirst}>Back to #1</Button>}
    <Button variant="secondary" size="sm" className={`min-h-11 ${index === 0 ? 'hidden sm:inline-flex' : ''}`}
      onClick={onPrevious} disabled={index === 0 || disabled}>Previous</Button>
    <Button variant="secondary" size="sm" className="min-h-11" onClick={onNext} disabled={index >= count - 1 || disabled}>Next</Button>
  </div>
}
