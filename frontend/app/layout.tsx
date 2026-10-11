import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Graveyard Autopsy — Evidence-Based API Lifecycle Investigator",
  description:
    "Find API endpoints that may be ready for retirement—with evidence, not guesses. Compares OpenAPI contracts, backend routes, and observed request logs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}

