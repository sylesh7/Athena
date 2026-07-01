"use client"

import { useEffect, useState } from "react"

export function ArtDecoSunburst({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const rays = 24

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <svg
        viewBox="0 0 800 800"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] opacity-10"
      >
        {Array.from({ length: rays }).map((_, i) => {
          const angle = (i * 360) / rays
          return (
            <line
              key={i}
              x1="400"
              y1="400"
              x2="400"
              y2="0"
              stroke="oklch(0.72 0.12 85)"
              strokeWidth="1"
              transform={`rotate(${angle} 400 400)`}
              style={{
                opacity: mounted ? 1 : 0,
                transition: `opacity 0.5s ease ${i * 0.05}s`,
              }}
            />
          )
        })}
        <circle
          cx="400"
          cy="400"
          r="80"
          fill="none"
          stroke="oklch(0.72 0.12 85)"
          strokeWidth="1"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.8s ease 0.5s",
          }}
        />
        <circle
          cx="400"
          cy="400"
          r="120"
          fill="none"
          stroke="oklch(0.72 0.12 85)"
          strokeWidth="0.5"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.8s ease 0.7s",
          }}
        />
      </svg>
    </div>
  )
}
