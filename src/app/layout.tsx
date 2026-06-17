import type { Metadata } from "next";
import { Space_Grotesk, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "EMVY Mini AI Strategy Assessment | 30-day AI roadmap for your business",
  description:
    "Get a personalised 30/60/90 day AI roadmap in around 5 minutes. Free, no commitment, and the exact steps to remove manual work.",
  openGraph: {
    title: "EMVY Mini AI Strategy Assessment | 30-day AI roadmap for your business",
    description:
      "Get a personalised 30/60/90 day AI roadmap in 5 minutes. Free, no commitment.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${manrope.variable} ${jetbrainsMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
