import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'uWebsites — Dashboard',
  icons: { icon: '/icon.svg', apple: '/icon.svg', shortcut: '/icon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>)
}
