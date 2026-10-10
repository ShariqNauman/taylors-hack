import Link from "next/link";

/** Eye mark plus EARLYEYE in Saira. Links to the Live screen. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M3 16c3.5-6 8-9 13-9s9.5 3 13 9c-3.5 6-8 9-13 9s-9.5-3-13-9z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16" r="4.5" fill="currentColor" />
      </svg>
      <span className="ee-display text-[26px] tracking-[0.04em]">EarlyEye</span>
    </Link>
  );
}
