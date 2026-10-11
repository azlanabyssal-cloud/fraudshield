import type { Chip } from '../../engine/assistant';
import { Icon } from './Icon';

const external = (href: string): boolean => /^https?:/i.test(href);
/** The engine's labels begin with an emoji (they were written for a chat bubble). The screen shows plain words, and a screen reader no longer reads out "telephone receiver". */
export const plain = (label: string): string => label.replace(/^(?:[0-9#*]\ufe0f?\u20e3|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3|\s)+/u, '').trim() || label;

/** Suggested replies as a list of options: easy to hit with a thumb and easy to read. A link opens where it points; anything else asks the assistant. */
export function Chips({ chips, onPress }: { chips: readonly Chip[]; onPress: (chip: Chip) => void }) {
  return (
    <div className="chips" role="group" aria-label="Suggested replies">
      {chips.map((c, i) => c.href
        ? <a key={i} className={'chip' + (c.cta ? ' chip--cta' : '')} href={c.href} {...(external(c.href) ? { target: '_blank', rel: 'noopener' } : {})}><span>{plain(c.label)}</span><Icon name="chevron" size={18} /></a>
        : <button key={i} type="button" className="chip" onClick={() => onPress(c)}><span>{plain(c.label)}</span><Icon name="chevron" size={18} /></button>)}
    </div>
  );
}
