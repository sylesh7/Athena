export function ArtDecoDivider({ variant = "stepped" }: { variant?: "stepped" | "fan" | "chevron" }) {
  if (variant === "stepped") {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-end gap-1">
          <div className="w-8 h-2 bg-primary" />
          <div className="w-6 h-4 bg-primary" />
          <div className="w-4 h-6 bg-primary" />
          <div className="w-6 h-4 bg-primary" />
          <div className="w-8 h-2 bg-primary" />
        </div>
      </div>
    )
  }

  if (variant === "fan") {
    return (
      <div className="flex items-center justify-center py-16">
        <svg width="200" height="60" viewBox="0 0 200 60" className="text-primary">
          {Array.from({ length: 9 }).map((_, i) => {
            const angle = -40 + i * 10
            return (
              <line
                key={i}
                x1="100"
                y1="60"
                x2={100 + Math.sin((angle * Math.PI) / 180) * 50}
                y2={60 - Math.cos((angle * Math.PI) / 180) * 50}
                stroke="currentColor"
                strokeWidth="2"
              />
            )
          })}
          <circle cx="100" cy="60" r="6" fill="currentColor" />
        </svg>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-2">
        <div className="w-16 h-0.5 bg-primary" />
        <div className="w-12 h-0.5 bg-primary" />
        <div className="w-8 h-0.5 bg-primary" />
      </div>
    </div>
  )
}
