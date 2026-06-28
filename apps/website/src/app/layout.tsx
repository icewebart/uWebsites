import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'uWebsites — build and run all your sites with AI' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>)
}
