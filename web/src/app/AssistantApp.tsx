import { useEffect, useRef, useState } from 'react';
import { describe } from '../engine/assistant';
import type { ChatMessage } from './chatState';
import { openChips } from './chatState';
import { Chips } from './components/Chips';
import { Composer } from './components/Composer';
import { Diagnostics } from './components/Diagnostics';
import { Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { LinkVerdictCard, MessageVerdictCard } from './components/VerdictCard';
import { createAppOps } from './appOps';
import { useChat } from './hooks/useChat';
import type { UseChatOptions } from './hooks/useChat';
import { useNameModel } from './hooks/useNameModel';
import type { NameModelOptions } from './hooks/useNameModel';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useSpeaker } from './hooks/useSpeaker';
import { useVoice, VOICE_CONSENT_KEY } from './hooks/useVoice';
import type { VoiceLang } from './hooks/useVoice';

const NAV: readonly [string, string][] = [['Home', 'index.html'], ['Tips', 'tips.html'], ['Data', 'data.html'], ['Report', 'report.html'], ['About', 'about.html']];

function Bubble({ m }: { m: ChatMessage }) {
  if (m.from === 'user') return <li className="msg msg--user"><span className="sr-only">You said: </span><p>{m.text}</p></li>;
  if (m.from === 'chips') return null;
  if (m.from === 'image') return <li className="msg msg--user msg--image"><img src={m.url} alt="The picture you shared" /></li>;
  const b = m.block;
  if (b.type === 'message-verdict') return <li className="msg msg--card"><MessageVerdictCard verdict={b.verdict} /></li>;
  if (b.type === 'link-verdict') return <li className="msg msg--card"><LinkVerdictCard verdict={b.verdict} /></li>;
  return <li className={'msg msg--bot' + (m.urgent ? ' msg--urgent' : '')}><span className="sr-only">Assistant: </span><p>{describe(b)}</p></li>;
}

export function AssistantApp(props: UseChatOptions & { nameModel?: Pick<NameModelOptions, 'url' | 'retryMs'> } = {}) {
  const reduced = useReducedMotion();
  const [ops] = useState(() => props.ops ?? createAppOps());
  // a test that fixes the model's status turns the loader off; otherwise the page loads, validates and announces the model itself
  const model = useNameModel({ ...props.nameModel, enabled: props.modelStatus === undefined, onFail: code => { ops.record({ kind: 'model', code }); } });
  const fileInput = useRef<HTMLInputElement>(null);
  const chat = useChat({ ...props, ops, modelStatus: props.modelStatus ?? model.status, instant: props.instant ?? reduced, pickImage: () => fileInput.current?.click() });
  const [draft, setDraft] = useState('');
  const [lang, setLang] = useState<VoiceLang>('en-IN');
  const spoken = useRef(false);   // the last message came from the microphone: when the reply is done, listen again
  const send = chat.send;
  const voice = useVoice({ lang, onDraft: setDraft, onText: t => { spoken.current = true; setDraft(''); send(t); } });

  const speaker = useSpeaker();
  const { resume } = voice, { whenIdle, busy, say: speak, on: speaking } = speaker;
  const idle = !chat.typing && openChips(chat.state) !== null;
  // after a spoken question, listen again, but only once the assistant has finished speaking, so the microphone cannot hear the voice and answer it
  useEffect(() => { if (idle && spoken.current) { spoken.current = false; if (speaking && busy()) whenIdle(resume); else resume(); } }, [idle, resume, speaking, busy, whenIdle]);
  // say each new piece of what the assistant shows (never the greeting that was there when the page opened)
  const lastSpoken = useRef(Math.max(0, ...chat.state.messages.map(m => m.id)));
  useEffect(() => {
    for (const m of chat.state.messages) {
      if (m.id <= lastSpoken.current) continue;
      lastSpoken.current = m.id;
      if (speaking && m.from === 'bot') speak(describe(m.block));
    }
  }, [chat.state.messages, speaking, speak]);

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
    if (count > seen.current && pinned.current) {
      // a result is read from its top (the status and the headline), not from the options under it
      const shown = chat.state.messages.filter(m => m.from !== 'chips'), last = shown[shown.length - 1];
      const card = last && last.from === 'bot' && /verdict$/.test(last.block.type) ? document.querySelectorAll('.msg--card') : null;
      const target = card && card.length > 0 ? card[card.length - 1] : null;
      if (target) target.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      else bottom.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
    }
    seen.current = count;
  }, [count, reduced, chat.state.messages]);

  const chips = openChips(chat.state);
  return (
    <>
      <a className="skip-link" href="#message">Skip to the message box</a>
      <header className="site-header">
        <a className="brand" href="index.html" aria-label="FraudShield home"><Logo size={30} ground="dark" /><span>Fraud<span className="brand__accent">Shield</span></span></a>
        <nav className="nav-inline" aria-label="Main"><ul>{NAV.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul></nav>
        <a className="header-call" href="tel:1930"><Icon name="phone" size={18} /><span>Call 1930</span></a>
        <details className="menu">
          <summary aria-label="Menu"><Icon name="menu" /></summary>
          <nav aria-label="Main (menu)"><ul>{NAV.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul></nav>
        </details>
      </header>
      <main id="main" className="assistant">
        <div className="intro">
          <h1 className="assistant__title">Check a message, a link or what happened</h1>
          <p className="assistant__lead">Say or paste it. I will tell you which scam it resembles, quote the exact words that gave it away, and say what to do next.</p>
          {speaker.supported && <button type="button" className="btn btn--toggle" aria-pressed={speaking} onClick={speaker.toggle}><Icon name={speaking ? 'volume' : 'volumeOff'} size={18} />{speaking ? 'Spoken replies: on' : 'Spoken replies: off'}</button>}
        </div>
        {speaker.supported && <p className="sr-only" role="status">{speaking ? 'Spoken replies on. The assistant now speaks new messages, so your screen reader will not read them out a second time.' : ''}</p>}
        <div className="log" role="log" aria-live={speaking ? 'off' : 'polite'} aria-relevant="additions" aria-label="Conversation with the FraudShield assistant">
          <ol className="log__list">
            {chat.state.messages.map(m => <Bubble key={m.id} m={m} />)}
            {chat.typing && <li className="typing" aria-hidden="true"><span /><span /><span /></li>}
          </ol>
        </div>
        {chat.progress && <p className="progress" role="status"><span className="progress__dots" aria-hidden="true"><span /><span /><span /></span>{chat.progress}</p>}
        {chat.typing && <p className="sr-only" role="status">The assistant is typing</p>}
        {chips && !chat.typing && <Chips chips={chips} onPress={chat.press} />}
        <div ref={bottom} />
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void chat.attach(f); }} />
        <Composer onAttachClick={() => { chat.tools.warm(); fileInput.current?.click(); }} onPasteImage={f => { void chat.attach(f); }} draft={draft} onDraft={setDraft} onSend={t => { spoken.current = false; chat.send(t); }} voice={voice} lang={lang} onLang={setLang} />
        <Diagnostics summary={() => chat.ops.summary()} version={chat.version} model={{ status: props.modelStatus ?? model.status, retry: model.retry }} onErase={() => { voice.stop(); chat.erase([VOICE_CONSENT_KEY]); try { window.localStorage.removeItem(VOICE_CONSENT_KEY); } catch { /* ignore */ } }} />
      </main>
      <footer className="site-footer">
        <p>FraudShield is a free, independent project. It is not a government service. If money has left your account, the first hour matters most.</p>
        <ul className="help-links">
          <li><a className="help-link help-link--cta" href="tel:1930"><Icon name="phone" /><span>Call 1930 (free, all day)</span></a></li>
          <li><a className="help-link" href="report.html"><Icon name="file" /><span>How to report it</span></a></li>
          <li><a className="help-link" href="tel:112"><Icon name="siren" /><span>Emergency: call 112</span></a></li>
        </ul>
      </footer>
    </>
  );
}
