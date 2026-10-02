import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from 'next/font/google'
import "./globals.css";
import Nav from './components/Nav'
import Footer from './components/Footer'
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
        <div className="min-h-screen flex flex-col">
          <Nav />
          <main className="max-w-4xl mx-auto px-6 py-8 flex-1 w-full">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
