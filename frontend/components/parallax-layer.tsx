"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"

interface ParallaxLayerProps {
  speed: number
  fade?: boolean
  className?: string
  children: ReactNode
}

export function ParallaxLayer({ speed, fade = false, className = "", children }: ParallaxLayerProps) {
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        setScrollY(window.scrollY)
        ticking = false
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div
      className={className}
      style={{
        transform: `translate3d(0, ${scrollY * speed}px, 0)`,
        opacity: fade ? Math.max(1 - scrollY / 500, 0) : 1,
      }}
    >
      {children}
    </div>
  )
}
