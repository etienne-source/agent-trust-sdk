import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgenticTrust starter",
  description: "Next.js App Router starter with a placeholder did:web identity and signed llms.txt rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
