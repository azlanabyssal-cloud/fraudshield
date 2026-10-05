import type { CheckedLink } from '../../engine/core';
import type { MessageVerdict } from '../../engine/msgcheck';
import { LINK_ADVICE } from '../../engine/assistant';
import type { Level } from '../../engine/ops';

type Tone = 'danger' | 'warn' | 'neutral' | 'ok';
/** How each result is named and drawn. The words and the icon carry the meaning, never colour alone, and nothing is ever called "safe". */
const LEVELS: Record<Level, { label: string; icon: string; tone: Tone }> = {
  scam: { label: 'Looks like a scam', icon: '🚫', tone: 'danger' },
  suspicious: { label: 'Suspicious', icon: '⚠️', tone: 'warn' },
  unverified: { label: "Couldn't verify", icon: '❔', tone: 'neutral' },
  official: { label: 'Matches an official address', icon: '✅', tone: 'ok' },
  nothing: { label: 'No known pattern found', icon: '❔', tone: 'neutral' }
};

const NOT_PROOF = 'This is evidence, not proof. A result from me never means a message is safe.';

function Frame({ level, headline, children }: { level: Level; headline: string; children: React.ReactNode }) {
  const m = LEVELS[level];
  return (
    <article className={'verdict verdict--' + m.tone} aria-label={m.label + '. ' + headline}>
      <header className="verdict__head">
        <span className="verdict__icon" aria-hidden="true">{m.icon}</span>
        <div>
          <p className="verdict__label">{m.label}</p>
          <h2 className="verdict__headline">{headline}</h2>
        </div>
      </header>
      {children}
      <p className="verdict__note">{NOT_PROOF}</p>
    </article>
  );
}

export function MessageVerdictCard({ verdict: v }: { verdict: MessageVerdict }) {
  const evidence = v.evidence.filter(e => e.id !== 'link-scam' && e.id !== 'link-suspicious' && e.id !== 'link-unverified').slice(0, 4);
  return (
    <Frame level={v.level} headline={v.headline}>
      {evidence.length > 0 && (
        <section className="verdict__section">
          <h3>What gave it away</h3>
          <ul className="evidence">
            {evidence.map(e => (
              <li key={e.id}><q className="evidence__quote">{e.quote}</q><span className="evidence__why">{e.label}</span></li>
            ))}
          </ul>
        </section>
      )}
      {v.link && (
        <section className="verdict__section">
          <h3>The link in it</h3>
          <p className="verdict__link"><strong>{v.link.headline}</strong></p>
          <ul className="reasons">{v.link.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        </section>
      )}
      <section className="verdict__section">
        <h3>What to do</h3>
        <p>{v.next.join(' ')}</p>
      </section>
    </Frame>
  );
}

export function LinkVerdictCard({ verdict: v }: { verdict: CheckedLink }) {
  return (
    <Frame level={v.level} headline={v.headline}>
      <section className="verdict__section">
        <h3>Why</h3>
        <ul className="reasons">{v.reasons.map(r => <li key={r}>{r}</li>)}</ul>
      </section>
      <section className="verdict__section"><h3>What to do</h3><p>{LINK_ADVICE}</p></section>
    </Frame>
  );
}
