import mark from '../../../../brand/mark.json';

type Ground = 'light' | 'dark';

/** The FraudShield mark, drawn from brand/mark.json (the file the SVGs, the favicons and the app icons are built from), so the page and the icons cannot drift apart.
 *  `ground` is the colour of what it sits on: a navy shield on light, a cream one on dark. */
export function Logo({ size = 28, ground = 'light' }: { size?: number; ground?: Ground }) {
  const c = mark.colors, shield = ground === 'light' ? c.navy : c.cream, inner = ground === 'light' ? 'none' : c.navy;
  return (
    <svg className="logo-mark" width={size} height={size} viewBox={`0 0 ${mark.viewBox} ${mark.viewBox}`} aria-hidden="true" focusable="false">
      <path d={mark.shield} fill={shield} />
      <circle cx={mark.lens.cx} cy={mark.lens.cy} r={mark.lens.r} fill={inner} stroke={c.orange} strokeWidth={mark.lens.width} />
      <path d={mark.handle.d} stroke={c.orange} strokeWidth={mark.handle.width} strokeLinecap="round" fill="none" />
    </svg>
  );
}
