import type { Metadata } from 'next';
import { themeInitScript } from '../lib/theme';
import './globals.css';
export const metadata: Metadata = {
  title: 'Hacker Times',
  description: 'A newspaper from Hacker News, regularly updated. Independent headlines, original sources.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en" suppressHydrationWarning><head><link rel="preload" href="/fonts/ManufacturingConsent-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous"/><script dangerouslySetInnerHTML={{__html:themeInitScript}}/></head><body>{children}</body></html>;
}
