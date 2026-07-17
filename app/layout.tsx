import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capybara Healthy Work Boundaries Clock",
  description:
    "A cozy, local-first work timer for healthy boundaries and complete clock-offs.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
  },
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
