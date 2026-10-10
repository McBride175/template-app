import { Suspense } from 'react'
import AccountingActivityBoundary from './components/AccountingActivityBoundary'
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from 'next/font/google'
import "./globals.css";
import ApplicationFrame from './components/shell/ApplicationFrame'
import { getSiteUrl } from '@/lib/site-url'

const siteUrl = getSiteUrl()
const description = 'Yuohme helps businesses prioritise which overdue customers need chasing first.'
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: 'normal',
  display: 'swap',
  variable: '--font-yuohme-interface',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Yuohme',
    template: '%s | Yuohme',
  },
  description,
  alternates: {
    canonical: '/',
  },
  // Browser ICO is discovered from app/favicon.ico. Do not declare it twice.
  icons: {
    apple: [{ url: '/brand/icons/logo-square-180.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Yuohme',
    description,
    url: siteUrl,
    siteName: 'Yuohme',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Yuohme',
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body className="antialiased bg-page">
        <ApplicationFrame>
          <Suspense fallback={null}><AccountingActivityBoundary /></Suspense>
          {children}
        </ApplicationFrame>
      </body>
    </html>
  );
}
