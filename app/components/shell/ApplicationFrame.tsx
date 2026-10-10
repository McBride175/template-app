'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import Nav from '../Nav'
import Footer from '../Footer'
import ProductWorkspace from './ProductWorkspace'
import { isWorkspacePath } from './navigation'

export default function ApplicationFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (isWorkspacePath(pathname)) return <ProductWorkspace pathname={pathname}>{children}</ProductWorkspace>
  // Preserve public, authentication and focused onboarding layouts verbatim.
  return <div className="min-h-screen flex flex-col">
    <Nav />
    <main className="max-w-4xl mx-auto px-6 py-8 flex-1 w-full">{children}</main>
    <Footer />
  </div>
}
