/**
 * Zapidly logo: a chat bubble with a lightning bolt. Colours come from the
 * --brand-mark-* tokens in globals.css. `id` must be unique per page - it
 * names the gradient, and a duplicate id inside a hidden element (the
 * off-canvas sidebar on mobile) would blank every other copy.
 */
export function BrandMark({ id, size = 28 }: { id: string; size?: number }) {
  const gradientId = `brand-mark-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: "var(--brand-mark-from)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-mark-to)" }} />
        </linearGradient>
      </defs>
      <path
        d="M16 2C8.27 2 2 7.9 2 15.2c0 3.1 1.13 5.95 3.02 8.2L4 29l5.9-2.4A14.8 14.8 0 0 0 16 28.4c7.73 0 14-5.9 14-13.2S23.73 2 16 2Z"
        fill={`url(#${gradientId})`}
      />
      <path d="M11 9.5h10.5l-6.2 7.2h5.2L10.6 23l3.4-5.3H9.4L11 9.5Z" fill="var(--brand-mark-bolt)" />
    </svg>
  );
}
