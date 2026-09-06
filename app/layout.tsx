import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "./patient.css";
import "./visual-system.css";
import PatientNavigation from "@/components/PatientNavigation";
import SiteFrame from "@/components/SiteFrame";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "MedProj - Physical Therapy Garden",
  description: "AI-guided physical therapy that grows a tree with every session.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={manrope.variable}>
      <body><SiteFrame>{children}</SiteFrame><PatientNavigation /></body>
    </html>
  );
}
