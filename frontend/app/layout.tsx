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
    "Athena is an immersive, narrative-driven, web3 experience following the next step in human survival.",
  openGraph: {
    title: "Athena",
    description:
      "Athena is an immersive, narrative-driven, web3 experience following the next step in human survival.",
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
