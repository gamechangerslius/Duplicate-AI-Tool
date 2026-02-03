import type { Metadata } from "next";
import Script from "next/script";
import Providers from "./providers"; // Import the provider
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
        <Providers>
          {children}
        </Providers>

        <Script
          id="marker-io"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.markerConfig = {
                project: '${process.env.NEXT_PUBLIC_MARKER_IO_PROJECT_ID || '6785ee3db0ca3c28a63f32c2'}',
                source: 'snippet'
              };
              !function(e,r,a){if(!e.__Marker){e.__Marker={};var t=[],n={__cs:t};["show","hide","isVisible","capture","cancelCapture","unload","reload","isExtensionInstalled","setReporter","setCustomData","on","off"].forEach(function(e){n[e]=function(){var r=Array.prototype.slice.call(arguments);r.unshift(e),t.push(r)}}),e.Marker=n;var s=r.createElement("script");s.async=1,s.src="https://edge.marker.io/latest/shim.js";var i=r.getElementsByTagName("script")[0];i.parentNode.insertBefore(s,i)}}(window,document);
            `,
          }}
        />
      </body>
    </html>
  );
}