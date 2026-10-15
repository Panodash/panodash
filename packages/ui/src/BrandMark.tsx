export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Panodash"
    >
      <rect width="48" height="48" rx="10" fill="var(--brand-ink-800)" />
      <rect x="15" y="13" width="12" height="24" rx="1" fill="var(--brand-signal-500)" />
      <rect x="31" y="31" width="6" height="6" rx="1" fill="var(--brand-mist-300)" />
    </svg>
  );
}
