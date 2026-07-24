// web/src/components/Logo.tsx — "Crossed Cues": two crossed cue strokes over
// a ball, chosen during brainstorming (docs/superpowers/specs/2026-07-20-
// player-accounts-dashboard-settings-branding-design.md, §9) from four
// options reviewed visually. Inline SVG (not a static asset) so size/color
// can be controlled via props wherever it's used.
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="logo-gradient-a" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00ff87" />
          <stop offset="100%" stopColor="#04f5ff" />
        </linearGradient>
        <linearGradient id="logo-gradient-b" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#963cff" />
          <stop offset="100%" stopColor="#ff2882" />
        </linearGradient>
      </defs>
      <rect
        x="45"
        y="10"
        width="10"
        height="60"
        rx="5"
        fill="url(#logo-gradient-a)"
        transform="rotate(-28 50 50)"
      />
      <rect
        x="45"
        y="10"
        width="10"
        height="60"
        rx="5"
        fill="url(#logo-gradient-b)"
        transform="rotate(28 50 50)"
      />
      <circle cx="50" cy="72" r="11" fill="#1a0d1f" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}
