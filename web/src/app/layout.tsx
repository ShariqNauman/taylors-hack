import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Saira_Condensed,
} from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AlarmLayer } from "@/components/alarm/alarm-layer";
import { PhonePanel } from "@/components/guard/phone-panel";
import { CameraWake } from "@/components/chrome/camera-wake";
import "./globals.css";

const saira = Saira_Condensed({
  variable: "--font-saira",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  adjustFontFallback: false,
});

const atkinsonMono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "EarlyEye", template: "%s · EarlyEye" },
  description:
    "Physical-aggression early warning for sites with cameras and a security desk.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light">
      <body
        className={`${saira.variable} ${atkinson.variable} ${atkinsonMono.variable} min-h-screen bg-ground text-ink antialiased`}
      >
        <AlarmLayer />
        {children}
        <PhonePanel />
        <CameraWake />
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
