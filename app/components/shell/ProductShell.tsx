'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import Button from '../ui/Button'
import Logo from '../ui/Logo'
import Alert from '../ui/Alert'
import { cn } from '@/lib/utils'
import { accountLinks, sectionMatches, workspaceLinks } from './navigation'

export interface ProductShellProps {
  children: ReactNode
  pathname: string
  accountLabel?: string
  sessionLoading?: boolean
  signingOut?: boolean
  signOutError?: string | null
  onSignOut?: () => void
  /** Existing legacy pages that already supply their own main landmark. */
  pageHasMain?: boolean
  contentWidth?: 'wide' | 'reading'
}

export default function ProductShell({
  children, pathname, accountLabel, sessionLoading = false, signingOut = false,
  signOutError, onSignOut, pageHasMain = false, contentWidth = 'wide',
}: ProductShellProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const menuButton = useRef<HTMLSpanElement>(null)
  const rail = useRef<HTMLElement>(null)
  const dialogId = useId()
  const headingId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => dialog.current?.close()
  const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
    // Preserve modified-click/new-tab semantics and never intercept routing.
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeMenu()
  }

  // Browser Back/Forward and viewport changes also dismiss the modal menu.
  useEffect(() => { dialog.current?.close() }, [pathname])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const changed = () => { if (desktop.matches) dialog.current?.close() }
    const historyChanged = () => dialog.current?.close()
    desktop.addEventListener('change', changed)
    window.addEventListener('popstate', historyChanged)
    window.addEventListener('hashchange', historyChanged)
    return () => {
      desktop.removeEventListener('change', changed)
      window.removeEventListener('popstate', historyChanged)
      window.removeEventListener('hashchange', historyChanged)
    }
  }, [])

  function links(items: readonly { label: string; href: string; prefixes: readonly string[] }[]) {
    return items.map(item => {
      const active = sectionMatches(pathname, item.prefixes)
      return <Link key={item.href} href={item.href} onClick={followLink}
        aria-current={active ? 'page' : undefined}
        className={cn('flex min-h-11 items-center rounded-control border-l-2 px-3 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          active ? 'border-selected-accent bg-selected text-on-selected font-semibold' : 'border-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary')}>
        {item.label}
      </Link>
    })
  }

  const navigation = <>
    <nav aria-label="Primary navigation" className="space-y-1">{links(workspaceLinks)}</nav>
    <div className="mt-auto space-y-4 border-t border-border-default pt-4">
      <nav aria-label="Account navigation" className="space-y-1">{links(accountLinks)}</nav>
      <div className="flex gap-4 px-3 text-xs text-text-secondary">
        <Link href="/blog" onClick={followLink} className="rounded-control hover:text-link focus-visible:outline-2 focus-visible:outline-focus">Guides</Link>
        <Link href="/contact" onClick={followLink} className="rounded-control hover:text-link focus-visible:outline-2 focus-visible:outline-focus">Support</Link>
      </div>
      <div className="space-y-2 px-3">
        <p className="min-h-5 truncate text-xs text-text-secondary" title={accountLabel}>
          {sessionLoading ? 'Checking account…' : accountLabel ?? 'Account'}
        </p>
        {signOutError && <Alert variant="error">{signOutError}</Alert>}
        {onSignOut && <Button variant="ghost" size="sm" className="min-h-11 w-full justify-start px-0"
          onClick={onSignOut} disabled={sessionLoading || signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>}
      </div>
    </div>
  </>
  const Content = pageHasMain ? 'div' : 'main'

  return (
    <div className="min-h-dvh bg-page text-text-primary">
      <nav aria-label="Skip navigation">
        <a href="#workspace-content" className="sr-only z-50 bg-surface px-4 py-3 text-link focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-control focus:outline-2 focus:outline-focus">Skip to workspace</a>
      </nav>

      <aside ref={rail} aria-label="Workspace navigation" className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 overflow-y-auto border-r border-border-default bg-surface px-4 pb-5 lg:flex">
        <Link href="/dashboard" aria-label="Yuohme workspace" className="inline-flex self-start rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Logo decorative /></Link>
        {navigation}
      </aside>

      <header className="flex items-center justify-between border-b border-border-default bg-surface px-4 lg:hidden">
        <Link href="/dashboard" aria-label="Yuohme workspace" className="inline-flex shrink-0 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Logo decorative /></Link>
        <span ref={menuButton} className="inline-flex shrink-0"><Button variant="ghost" className="min-h-11 min-w-11 px-0" aria-label="Open navigation"
          aria-expanded={menuOpen} aria-controls={dialogId} aria-haspopup="dialog"
          onClick={() => { dialog.current?.showModal(); setMenuOpen(true) }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </Button></span>
      </header>

      <dialog ref={dialog} id={dialogId} aria-labelledby={headingId}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-sm border-0 border-l border-border-default bg-surface p-0 text-text-primary backdrop:bg-surface-inverse/30"
        onKeyDown={event => {
          if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')].filter(node => node.getClientRects().length > 0)
          const first = items[0], last = items[items.length - 1]
          if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus() }
        }}
        onClick={event => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeMenu()
        }}
        onClose={() => {
          setMenuOpen(false)
          if (window.matchMedia('(min-width: 64rem)').matches) {
            const link = rail.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ?? rail.current?.querySelector<HTMLAnchorElement>('a[aria-label="Yuohme workspace"]')
            link?.focus()
          }
          else menuButton.current?.querySelector('button')?.focus()
        }}>
        <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <h2 id={headingId} className="text-lg font-semibold">Navigation</h2>
            <Button variant="ghost" className="min-h-11" onClick={closeMenu}>Close navigation</Button>
          </div>
          {navigation}
        </div>
      </dialog>

      <div className="min-w-0 lg:pl-60">
        <Content id="workspace-content" tabIndex={-1} className={cn('min-w-0 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8', contentWidth === 'reading' && 'mx-auto max-w-4xl')}>
          {children}
        </Content>
      </div>
    </div>
  )
}
