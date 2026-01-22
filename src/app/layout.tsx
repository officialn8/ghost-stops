import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

// UI Font - Inter for body text and interface elements
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Display Font - Fraunces for headings and hero text
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
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
        className={`${inter.variable} ${fraunces.variable} font-sans bg-neutral-bg text-text-primary`}
        style={{
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
