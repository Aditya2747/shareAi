import type { Metadata, Viewport } from 'next';
import { Source_Sans_3 } from 'next/font/google';
import './globals.css';

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-chat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'shareAi',
  description: 'Turn natural language into secure, shareable, executable workflows',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#212121',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${sourceSans.variable}`} suppressHydrationWarning>
      <body className="bg-chat-bg text-chat-text antialiased font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
