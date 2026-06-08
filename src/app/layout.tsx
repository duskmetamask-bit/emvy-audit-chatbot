import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EMVY AI Audit | Business AI Readiness Assessment",
  description: "Answer a few questions to get personalized AI recommendations for your business. Takes 7-10 minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} min-h-full flex flex-col antialiased`}>
        {children}
      </body>
    </html>
  );
}
