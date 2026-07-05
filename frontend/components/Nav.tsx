"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { arcTestnet } from "@/lib/wagmi";

function truncate(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function switchOrAddArcTestnet() {
  const ethereum = (window as unknown as { ethereum?: any }).ethereum;
  if (!ethereum) return;
  const chainIdHex = `0x${arcTestnet.id.toString(16)}`;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError: any) {
    if (switchError?.code === 4902) {
      try {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: arcTestnet.name,
              nativeCurrency: arcTestnet.nativeCurrency,
              rpcUrls: arcTestnet.rpcUrls.default.http,
              blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
            },
          ],
        });
      } catch (addError) {
        console.error("Failed to add Arc Testnet to wallet:", addError);
      }
    } else {
      console.error("Failed to switch to Arc Testnet:", switchError);
    }
  }
}

export default function Nav() {
  const bar = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const isLanding = pathname === "/";
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const [isSwitching, setIsSwitching] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isConnected && isLanding) {
      router.push("/dashboard");
    }
  }, [isConnected, isLanding, router]);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
      if (bar.current) bar.current.style.width = `${pct}%`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const wrongNetwork = isConnected && chainId !== arcTestnet.id;

  const handleWalletClick = async () => {
    setConnectError(null);
    if (!isConnected) {
      // Deliberately NOT passing `chainId` here (unlike an earlier version) —
      // bundling a chain switch into the initial connect() call means the
      // whole connection can fail if the wallet has never seen Arc Testnet
      // before (near-certain for an obscure custom chain), even though
      // switchOrAddArcTestnet() below already has the correct fallback for
      // exactly that case. Connect first with no chain requirement, then
      // switch/add the chain as a separate, already-proven-reliable step.
      const metaMask = connectors.find((c) => c.id === "metaMask" || c.name === "MetaMask") ?? connectors[0];
      if (!metaMask) {
        setConnectError("No injected wallet found — install the MetaMask extension and reload this page.");
        return;
      }
      try {
        await connectAsync({ connector: metaMask });
      } catch (err) {
        console.error("Wallet connect failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        setConnectError(
          message.toLowerCase().includes("rejected") || message.toLowerCase().includes("denied")
            ? "Connection request rejected in MetaMask."
            : `Couldn't connect to MetaMask: ${message}`
        );
        return;
      }
      // Now that a real account is connected, make sure it's on Arc Testnet —
      // switchOrAddArcTestnet() handles both "switch to an already-added
      // chain" and "wallet has never seen this chain, add it" (error 4902).
      setIsSwitching(true);
      await switchOrAddArcTestnet();
      setIsSwitching(false);
    } else if (wrongNetwork) {
      setIsSwitching(true);
      await switchOrAddArcTestnet();
      setIsSwitching(false);
    } else {
      disconnect();
    }
  };

  const walletLabel = !mounted
    ? "CONNECT WALLET"
    : !isConnected
      ? isConnecting
        ? "CONNECTING..."
        : "CONNECT WALLET"
      : wrongNetwork
        ? isSwitching
          ? "SWITCHING..."
          : "SWITCH TO ARC"
        : truncate(address!);

  return (
    <nav className="nav">
      <div className="nav-progress" ref={bar} />
      <a className="nav-brand" href="#top" aria-label="Home">
        <Image src="/image/63b814185c1004b71b3cafd4_icon.svg" alt="Athena" width={40} height={40} />
      </a>
      <div className="nav-spacer" />
      <div className="nav-links">
        {isLanding ? (
          <>
            <a className="nav-item nav-cta" href="#about">
              <span className="label">ABOUT</span>
              <span className="num">001</span>
            </a>
            <a className="nav-item icon-only" href="#" aria-label="Discord">
              <Image src="/image/63b814185c10040da13cafe8_discord.svg" alt="Discord" width={20} height={20} />
              <span className="num">002</span>
            </a>
            <a className="nav-item icon-only" href="#" aria-label="Twitter">
              <Image src="/image/63b814185c1004911d3cafe2_twitter.svg" alt="Twitter" width={20} height={20} />
              <span className="num">003</span>
            </a>
            <button type="button" className="nav-item nav-cta" onClick={handleWalletClick}>
              <span className="label">{walletLabel}</span>
              <span className="num">004</span>
            </button>
          </>
        ) : (
          <>
            <Link className="nav-item nav-cta" href="/dashboard">
              <span className="label">DASHBOARD</span>
              <span className="num">001</span>
            </Link>
            <Link className="nav-item nav-cta" href="/agents">
              <span className="label">AGENT ROSTER</span>
              <span className="num">002</span>
            </Link>
            <Link className="nav-item nav-cta" href="/live">
              <span className="label">LIVE STREAM VIEW</span>
              <span className="num">003</span>
            </Link>
            <Link className="nav-item nav-cta" href="/new-stream">
              <span className="label">NEW STREAM</span>
              <span className="num">004</span>
            </Link>
            <button type="button" className="nav-item nav-cta" onClick={handleWalletClick}>
              <span className="label">{walletLabel}</span>
              <span className="num">005</span>
            </button>
          </>
        )}
      </div>
      {connectError && (
        <div className="nav-wallet-error" role="alert">
          {connectError}
        </div>
      )}
    </nav>
  );
}
