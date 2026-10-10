import Link from "next/link";

/**
 * The EarlyEye mark: an eye with three signal-blue alert rays (design/brand/earlyeye-mark.svg).
 * Ink outline and pupil, signal-blue iris. Size in px.
 */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 6v6M18.5 9.5l3 5.2M45.5 9.5l-3 5.2" stroke="var(--signal)" strokeWidth="4" />
        <path
          d="M6 37c7-10.7 15.7-16 26-16s19 5.3 26 16c-7 10.7-15.7 16-26 16S13 47.7 6 37z"
          stroke="currentColor"
          strokeWidth="4.5"
        />
      </g>
      <circle cx="32" cy="37" r="10" fill="var(--signal)" />
      <circle cx="32" cy="37" r="4.2" fill="currentColor" />
      <circle cx="35.6" cy="33.4" r="2.1" fill="#fff" />
    </svg>
  );
}

/** Mark plus EarlyEye in Saira. Links to the Live screen. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
      <LogoMark />
      <span className="ee-display text-[26px] tracking-[0.04em]">EarlyEye</span>
    </Link>
  );
}
