import type { Metadata } from "next";
import { Chakra_Petch } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const chakra = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Athena — Autonomous Business Treasury",
  description:
    "Athena runs a business treasury autonomously on Arc: reads invoices, forecasts cash flow, commits every decision on-chain before executing, and proves it on reveal. Tameion Agents Hackathon.",
  openGraph: {
    title: "Athena — Autonomous Business Treasury",
    description:
      "Athena runs a business treasury autonomously on Arc: reads invoices, forecasts cash flow, commits every decision on-chain before executing, and proves it on reveal. Tameion Agents Hackathon.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={chakra.className}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
