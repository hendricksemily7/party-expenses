import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bach Party Splitter",
  description: "Track bach-party expenses, receipts, participants, and final settle-up totals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
