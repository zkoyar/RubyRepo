/// Inline SVG flags, one per language.
///
/// Emoji flags are not an option here: Windows ships no glyphs for them, so
/// `🇮🇹` renders as the letters `IT`. The selector would look broken on the very
/// platform the app runs on. These are drawn by hand, stay inside the bundle
/// (no external request, so the strict CSP is satisfied) and scale cleanly.
///
/// A thin border is drawn on top of every flag: without it the white band of
/// the Italian and French flags disappears into a light background.

interface FlagProps {
  title: string;
}

const VIEW_BOX = "0 0 20 14";

function Frame() {
  return (
    <rect x="0.4" y="0.4" width="19.2" height="13.2" rx="1.6" fill="none" stroke="rgb(0 0 0 / 18%)" strokeWidth="0.8" />
  );
}

/// Union Jack, simplified: the diagonals are drawn as plain crossing bars
/// because at 20×14 the fimbriation would collapse into a smudge anyway.
function UnitedKingdom({ title }: FlagProps) {
  return (
    <svg viewBox={VIEW_BOX} role="img" aria-label={title} className="flag">
      <title>{title}</title>
      <rect width="20" height="14" rx="2" fill="#012169" />
      <path d="M0 0 L20 14 M20 0 L0 14" stroke="#FFF" strokeWidth="2.8" />
      <path d="M0 0 L20 14 M20 0 L0 14" stroke="#C8102E" strokeWidth="1.4" />
      <path d="M10 0 V14 M0 7 H20" stroke="#FFF" strokeWidth="4.2" />
      <path d="M10 0 V14 M0 7 H20" stroke="#C8102E" strokeWidth="2.4" />
      <Frame />
    </svg>
  );
}

function Italy({ title }: FlagProps) {
  return (
    <svg viewBox={VIEW_BOX} role="img" aria-label={title} className="flag">
      <title>{title}</title>
      <rect width="20" height="14" rx="2" fill="#F1F2F1" />
      <path d="M0 2 A2 2 0 0 1 2 0 H6.67 V14 H2 A2 2 0 0 1 0 12 Z" fill="#008C45" />
      <path d="M13.33 0 H18 A2 2 0 0 1 20 2 V12 A2 2 0 0 1 18 14 H13.33 Z" fill="#CD212A" />
      <Frame />
    </svg>
  );
}

function France({ title }: FlagProps) {
  return (
    <svg viewBox={VIEW_BOX} role="img" aria-label={title} className="flag">
      <title>{title}</title>
      <rect width="20" height="14" rx="2" fill="#F1F2F1" />
      <path d="M0 2 A2 2 0 0 1 2 0 H6.67 V14 H2 A2 2 0 0 1 0 12 Z" fill="#002395" />
      <path d="M13.33 0 H18 A2 2 0 0 1 20 2 V12 A2 2 0 0 1 18 14 H13.33 Z" fill="#ED2939" />
      <Frame />
    </svg>
  );
}

function Spain({ title }: FlagProps) {
  return (
    <svg viewBox={VIEW_BOX} role="img" aria-label={title} className="flag">
      <title>{title}</title>
      <rect width="20" height="14" rx="2" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
      <Frame />
    </svg>
  );
}

function Germany({ title }: FlagProps) {
  return (
    <svg viewBox={VIEW_BOX} role="img" aria-label={title} className="flag">
      <title>{title}</title>
      <rect width="20" height="14" rx="2" fill="#FFCE00" />
      <path d="M0 2 A2 2 0 0 1 2 0 H18 A2 2 0 0 1 20 2 V4.67 H0 Z" fill="#000" />
      <rect y="4.67" width="20" height="4.66" fill="#DD0000" />
      <Frame />
    </svg>
  );
}

// The lookup table lives in the consumer: a module that exports components
// plus a plain object loses fast refresh.
export { UnitedKingdom, Italy, France, Spain, Germany };
