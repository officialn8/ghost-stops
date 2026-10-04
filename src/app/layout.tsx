import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { ThemeProvider, THEME_SCRIPT } from "@/components/theme";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

// Words: Archivo, a variable font whose width axis gives station names their condensed signage cut.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

// Numbers: every figure on the page is set in JetBrains Mono.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const DESCRIPTION =
  "Chicago's ghost stops: the L stations emptier than they should be, and why. Daily CTA ridership, ranked by ghost score against each station's own line and neighbors.";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: `${SITE_NAME} · Chicago L ridership`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  openGraph: {
    siteName: SITE_NAME,
    title: `${SITE_NAME} · Chicago L ridership`,
    description: DESCRIPTION,
    type: "website",
  },
};

export const viewport: Viewport = {
  // The phone layout pads for the notch and home indicator itself.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F3EE" },
    { media: "(prefers-color-scheme: dark)", color: "#141518" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The inline script sets data-theme before React hydrates, so the attribute differs by design.
    <html lang="en" data-theme="dark" className={`${archivo.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
