import type { Chip } from '../../engine/assistant';

const external = (href: string): boolean => /^https?:/i.test(href);

/** A row of suggested replies. A link opens where it points; anything else asks the assistant. */
export function Chips({ chips, onPress }: { chips: readonly Chip[]; onPress: (chip: Chip) => void }) {
  return (
    <div className="chips" role="group" aria-label="Suggested replies">
      {chips.map((c, i) => c.href
        ? <a key={i} className={'chip' + (c.cta ? ' chip--cta' : '')} href={c.href} {...(external(c.href) ? { target: '_blank', rel: 'noopener' } : {})}>{c.label}</a>
        : <button key={i} type="button" className="chip" onClick={() => onPress(c)}>{c.label}</button>)}
    </div>
  );
}
