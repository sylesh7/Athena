import type { Metadata } from "next";
import { Chakra_Petch } from "next/font/google";
import "./globals.css";

const chakra = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Athena",
  description:
    "Athena commits a sealed routing prediction on-chain, posts a USDC bond, streams nanopayments via x402, and settles automatically based on verified outcomes — on Arc.",
  openGraph: {
    title: "Athena",
    description:
      "Athena commits a sealed routing prediction on-chain, posts a USDC bond, streams nanopayments via x402, and settles automatically based on verified outcomes — on Arc.",
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
      <body>{children}</body>
    </html>
  );
}
