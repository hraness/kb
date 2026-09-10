import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Wordcell: a knowledge base for coding agents";
const description =
  "Wordcell turns Markdown, backlinks, semantic search, and Git context into inspectable memory that coding agents can recover across sessions.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wordcell.io"),
  title,
  description,
  alternates: { canonical: "/" },
  icons: {
    icon: [{ type: "image/svg+xml", url: "/favicon.svg" }],
  },
  openGraph: {
    title,
    description,
    siteName: "Wordcell",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#f7f8fa", media: "(prefers-color-scheme: light)" },
    { color: "#121619", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
