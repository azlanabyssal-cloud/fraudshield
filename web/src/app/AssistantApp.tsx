import { useEffect, useRef, useState } from 'react';
import { describe } from '../engine/assistant';
import type { ChatMessage } from './chatState';
import { openChips } from './chatState';
import { Chips } from './components/Chips';
import { Composer } from './components/Composer';
import { Diagnostics } from './components/Diagnostics';
import { LinkVerdictCard, MessageVerdictCard } from './components/VerdictCard';
import { useChat } from './hooks/useChat';
import type { UseChatOptions } from './hooks/useChat';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useVoice, VOICE_CONSENT_KEY } from './hooks/useVoice';
import type { VoiceLang } from './hooks/useVoice';

const NAV: readonly [string, string][] = [['Home', 'index.html'], ['Tips', 'tips.html'], ['Data', 'data.html'], ['Report', 'report.html'], ['About', 'about.html']];

function Bubble({ m }: { m: ChatMessage }) {
  if (m.from === 'user') return <li className="msg msg--user"><span className="sr-only">You said: </span><p>{m.text}</p></li>;
  if (m.from === 'chips') return null;
  const b = m.block;
  if (b.type === 'message-verdict') return <li className="msg msg--card"><MessageVerdictCard verdict={b.verdict} /></li>;
  if (b.type === 'link-verdict') return <li className="msg msg--card"><LinkVerdictCard verdict={b.verdict} /></li>;
  return <li className={'msg msg--bot' + (m.urgent ? ' msg--urgent' : '')}><span className="sr-only">Assistant: </span><p>{describe(b)}</p></li>;
}

export function AssistantApp(props: UseChatOptions = {}) {
  const reduced = useReducedMotion();
  const chat = useChat({ ...props, instant: props.instant ?? reduced });
  const [draft, setDraft] = useState('');
  const [lang, setLang] = useState<VoiceLang>('en-IN');
  const spoken = useRef(false);   // the last message came from the microphone: when the reply is done, listen again
  const send = chat.send;
  const voice = useVoice({ lang, onDraft: setDraft, onText: t => { spoken.current = true; setDraft(''); send(t); } });

  const { resume } = voice;
  const idle = !chat.typing && openChips(chat.state) !== null;
  useEffect(() => { if (idle && spoken.current) { spoken.current = false; resume(); } }, [idle, resume]);

  // keep the newest message in view, unless the person has scrolled up to read
  const bottom = useRef<HTMLDivElement>(null), pinned = useRef(true);
  useEffect(() => {
    const onScroll = (): void => { pinned.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 180; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const count = chat.state.messages.length, seen = useRef(count);
  useEffect(() => {
    // follow only what arrives after the page opened: the greeting itself must not push the title out of view
    if (count > seen.current && pinned.current) bottom.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
    seen.current = count;
  }, [count, reduced]);

  const chips = openChips(chat.state);
  return (
    <>
      <a className="skip-link" href="#message">Skip to the message box</a>
      <header className="site-header">
        <a className="brand" href="index.html"><span className="brand__mark" aria-hidden="true">🛡️</span> FraudShield</a>
        <nav aria-label="Main"><ul>{NAV.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul></nav>
      </header>
      <main id="main" className="assistant">
        <h1 className="assistant__title">Check a message, a link or what happened</h1>
        <p className="assistant__lead">Say or paste it. I will tell you which scam it resembles, quote the exact words that gave it away, and say what to do next.</p>
        <div className="log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation with the FraudShield assistant">
          <ol className="log__list">
            {chat.state.messages.map(m => <Bubble key={m.id} m={m} />)}
            {chat.typing && <li className="typing" aria-hidden="true"><span /><span /><span /></li>}
          </ol>
        </div>
        {chat.typing && <p className="sr-only" role="status">The assistant is typing</p>}
        {chips && !chat.typing && <Chips chips={chips} onPress={chat.press} />}
        <div ref={bottom} />
        <Composer draft={draft} onDraft={setDraft} onSend={t => { spoken.current = false; chat.send(t); }} voice={voice} lang={lang} onLang={setLang} />
        <Diagnostics summary={() => chat.ops.summary()} version={chat.version} onErase={() => { voice.stop(); chat.erase([VOICE_CONSENT_KEY]); try { window.localStorage.removeItem(VOICE_CONSENT_KEY); } catch { /* ignore */ } }} />
      </main>
      <footer className="site-footer">
        <p>FraudShield is a free, independent project. It is not a government service. If money has left your account, the first hour matters most.</p>
        <div className="chips chips--center">
          <a className="chip chip--cta" href="tel:1930">📞 Call 1930 (free, all day)</a>
          <a className="chip" href="report.html">📝 How to report it</a>
          <a className="chip" href="tel:112">🚨 Emergency: call 112</a>
        </div>
      </footer>
    </>
  );
}
