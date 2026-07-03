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
            .map(() => "EVACUATE EARTH  *  ")
            .join("")}
        </span>
      </div>
      <button className="enter-btn" onClick={() => setGone(true)}>
        ENTER
      </button>
      <div className="loader-sub">EVACUATION BEGINS&nbsp;&nbsp;//&nbsp;&nbsp;2022</div>
    </div>
  );
}
