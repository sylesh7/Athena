"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";

const MAX_TILT_Y = 8;
const MAX_TILT_X = 4;

export default function HeroTilt({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (0.5 - px) * 2 * MAX_TILT_Y;
    const rotateX = (py - 0.5) * 2 * MAX_TILT_X;
    el.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "rotateX(0deg) rotateY(0deg)";
  };

  return (
    <div ref={ref} className={className} onPointerMove={handleMove} onPointerLeave={handleLeave}>
      {children}
    </div>
  );
}
