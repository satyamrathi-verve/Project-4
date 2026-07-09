/*
  Verve Advisory mark: two strokes meeting in a checkmark/"V" — navy (or white,
  for dark grounds) on the left, brand orange on the right, which stays legible
  against both light and dark backgrounds. Pure vector, so it scales cleanly
  wherever it's used — size it by setting font-size/height on a wrapper.
*/
export function VerveLogo({
  variant = "color",
  showWordmark = true,
  className = "",
}: {
  variant?: "color" | "reversed";
  showWordmark?: boolean;
  className?: string;
}) {
  const primary = variant === "reversed" ? "#ffffff" : "#23408b";
  const word = variant === "reversed" ? "#ffffff" : "#0d1b3f";
  const sub = variant === "reversed" ? "#97a6cc" : "#5b6478";

  return (
    <div className={`flex items-center gap-[0.45em] ${className}`}>
      <svg viewBox="0 0 48 40" className="h-[1em] w-[1.05em] flex-none" aria-hidden="true">
        <path d="M6 5 L22 34" stroke={primary} strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M42 5 L22 34" stroke="#fe7a15" strokeWidth="7" strokeLinecap="round" fill="none" />
      </svg>
      {showWordmark && (
        <span className="leading-none">
          <span className="block text-[0.62em] font-bold tracking-wide" style={{ color: word }}>
            VERVE
          </span>
          <span className="mt-[3px] block text-[0.21em] font-semibold uppercase tracking-[0.32em]" style={{ color: sub }}>
            Advisory
          </span>
        </span>
      )}
    </div>
  );
}
