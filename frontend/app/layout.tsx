import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Graveyard Autopsy — Evidence-Based API Lifecycle Investigator",
  description:
    "Find API endpoints that may be ready for retirement—with evidence, not guesses. Compares OpenAPI contracts, backend routes, and observed request logs.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0c] text-zinc-200 antialiased selection:bg-zinc-700 selection:text-white">
        {children}
      </body>
    </html>
  );
}
