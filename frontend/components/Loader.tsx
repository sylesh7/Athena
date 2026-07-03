"use client";

import { useEffect, useState } from "react";

export default function Loader() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    document.body.style.overflow = gone ? "" : "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [gone]);

  return (
    <div className={`loader${gone ? " gone" : ""}`} aria-hidden={gone}>
      <div className="loader-marquee">
        <span>
          {Array.from({ length: 6 })
            .map(() => "COMMIT  *  STREAM  *  SETTLE  *  ")
            .join("")}
        </span>
      </div>
      <button className="enter-btn" onClick={() => setGone(true)}>
        ENTER
      </button>
      <div className="loader-sub">LIVE ON ARC TESTNET&nbsp;&nbsp;//&nbsp;&nbsp;2026</div>
    </div>
  );
}
