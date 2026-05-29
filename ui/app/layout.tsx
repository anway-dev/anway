import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Restol",
  description: "End-to-end developer lifecycle harness",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <body style={{ margin: 0, height: "100%", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
