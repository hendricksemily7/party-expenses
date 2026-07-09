import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Square Up",
  description: "Track shared expenses and split responsibility quickly.",
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
