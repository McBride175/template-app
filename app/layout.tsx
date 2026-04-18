import type { Metadata } from "next";
import "./globals.css";
import Nav from './components/Nav'
import Footer from './components/Footer'
import { getSiteUrl } from '@/lib/site-url'

const siteUrl = getSiteUrl()

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Template App',
    template: '%s | Template App',
  },
  description: 'Template App with auth, subscriptions, and dashboard workflows.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Template App',
    description: 'Template App with auth, subscriptions, and dashboard workflows.',
    url: siteUrl,
    siteName: 'Template App',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Template App',
    description: 'Template App with auth, subscriptions, and dashboard workflows.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Template App',
    url: siteUrl,
  }

  return (
    <html lang="en">
      <body className="antialiased bg-gray-50">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
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
