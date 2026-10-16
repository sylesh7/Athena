import { createConfig, http, injected } from "wagmi";
import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  // `target: "metaMask"` — without this, `injected()` grabs whatever
  // `window.ethereum` resolves to, which can silently be a different wallet
  // extension (Coinbase Wallet, Brave's built-in wallet, Rabby, etc.) if more
  // than one is installed, even though the button says "Connect Wallet" and
  // the user expects MetaMask specifically.
  connectors: [injected({ target: "metaMask" })],
  transports: {
    [arcTestnet.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
