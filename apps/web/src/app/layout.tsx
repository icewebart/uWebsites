import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'uWebsites — Dashboard',
  icons: { icon: '/icon.svg', apple: '/icon.svg', shortcut: '/icon.svg' },
}

// Mobile: use the full viewport width, allow user zoom (accessibility), and
// respect the display cutout so nothing sits under the notch.
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#16324A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>)
}
