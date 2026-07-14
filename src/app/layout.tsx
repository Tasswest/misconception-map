import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Misconception Map",
    template: "%s · Misconception Map",
  },
  description:
    "Evidence-backed diagnostic tools for middle-school algebra and fractions.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#193b33",
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
