import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ad Gallery",
  description: "Simple ad creative gallery",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
