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
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220%] h-[220%] animate-sunburst-glow"
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
              strokeDasharray={400}
              strokeDashoffset={mounted ? 0 : 400}
              transform={`rotate(${angle} 400 400)`}
              style={{
                transition: `stroke-dashoffset 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.02}s`,
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}
