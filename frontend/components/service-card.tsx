"use client"

import type { ReactNode } from "react"

interface ServiceCardProps {
  title: string
  description: string
  icon: ReactNode
}

export function ServiceCard({ title, description, icon }: ServiceCardProps) {
  return (
    <div className="group relative p-8 bg-card border border-border hover:border-primary transition-all duration-500">
      {/* Corner decorations */}
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary" />

      <div className="flex flex-col items-center text-center">
        <div className="w-16 h-16 flex items-center justify-center text-primary mb-6 group-hover:scale-110 transition-transform duration-500">
          {icon}
        </div>
        <h3 className="font-serif text-2xl text-foreground mb-4">{title}</h3>
        <p className="text-muted-foreground leading-relaxed">{description}</p>
      </div>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-primary group-hover:w-3/4 transition-all duration-500" />
    </div>
  )
}
