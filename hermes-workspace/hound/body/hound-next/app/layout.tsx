import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const archivoBlack = localFont({
  src: '../public/fonts/ArchivoBlack-Regular.ttf',
  variable: '--font-archivo-black',
  display: 'swap',
})

const dotGothic = localFont({
  src: '../public/fonts/DotGothic16-Regular.ttf',
  variable: '--font-dot-gothic',
  display: 'swap',
})

const vt323 = localFont({
  src: '../public/fonts/VT323-Regular.ttf',
  variable: '--font-vt323',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'HOUND — Insert Coin',
  description: 'HOUND · 2000年アメリカ製 · Processing payment...',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080a06',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${archivoBlack.variable} ${dotGothic.variable} ${vt323.variable} dark`}
    >
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
