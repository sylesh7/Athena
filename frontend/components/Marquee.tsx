type Props = {
  text: string;
  className?: string;
  trackStyle?: React.CSSProperties;
  repeat?: number;
};

/** Infinite horizontal marquee band. `*` characters render in the accent color. */
export default function Marquee({ text, className = "", trackStyle, repeat = 4 }: Props) {
  const unit = ` ${text} * `;
  const parts = Array.from({ length: repeat }, () => unit);
  return (
    <div className={`band ${className}`.trim()}>
      <div className="track" style={trackStyle}>
        {parts.map((p, i) => {
          const [before, after] = p.split("*");
          return (
            <span key={i} style={{ color: "inherit" }}>
              {before}
              <span>*</span>
              {after}
            </span>
          );
        })}
      </div>
    </div>
  );
}
