import type { Metadata } from "next";
import { Inter, Fraunces, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme";
import { ResponsiveProvider } from "@/components/layout/ResponsiveProvider";
import "./globals.css";

// UI Font - Inter for body text and interface elements
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Display Font - Fraunces for headings and hero text (legacy)
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
});

// Display Font - Space Grotesk for Ghost Score, Station Names, Logo
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Mono Font - JetBrains Mono for stats, numbers, data
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Ghost Stops | Chicago CTA Rail Analytics",
  description: "Explore Chicago's emptiest CTA rail stations. Premium transit analytics with ghost scores, ridership trends, and real-time arrivals.",
  keywords: ["Chicago", "CTA", "transit", "ghost stations", "ridership", "analytics"],
  authors: [{ name: "Ghost Stops" }],
  openGraph: {
    title: "Ghost Stops | Chicago CTA Rail Analytics",
    description: "Discover Chicago's ghost stations - the emptiest stops on the CTA rail system.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased">
      <body
        className={`${inter.variable} ${fraunces.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans`}
        style={{
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <ResponsiveProvider>
            {children}
          </ResponsiveProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
