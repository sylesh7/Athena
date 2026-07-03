"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export default function Nav() {
  const bar = useRef<HTMLDivElement>(null);

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

  return (
    <nav className="nav">
      <div className="nav-progress" ref={bar} />
      <a className="nav-brand" href="#top" aria-label="Home">
        <Image src="/image/63b814185c1004b71b3cafd4_icon.svg" alt="Fates" width={40} height={40} />
      </a>
      <div className="nav-spacer" />
      <div className="nav-links">
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
        <a className="nav-item nav-cta" href="#">
          <span className="label">LAUNCH EXODUS</span>
          <span className="num">004</span>
        </a>
      </div>
    </nav>
  );
}
