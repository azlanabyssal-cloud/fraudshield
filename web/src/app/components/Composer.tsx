import { useLayoutEffect, useRef } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { VoiceLang, useVoice } from '../hooks/useVoice';

export const MAX_LENGTH = 4000;
type Voice = ReturnType<typeof useVoice>;

interface Props { onAttachClick: () => void; onPasteImage: (file: File) => void; draft: string; onDraft: (text: string) => void; onSend: (text: string) => void; voice: Voice; lang: VoiceLang; onLang: (lang: VoiceLang) => void }

export function Composer({ onAttachClick, onPasteImage, draft, onDraft, onSend, voice, lang, onLang }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  // grow with the text, up to a limit, without a layout jump
  useLayoutEffect(() => { const el = box.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 168) + 'px'; }, [draft]);

  const submit = (e?: FormEvent): void => { e?.preventDefault(); const t = draft.trim(); if (!t) return; onSend(t); onDraft(''); box.current?.focus(); };
  // Enter sends, Shift+Enter adds a line, and a key pressed while an Indian-language keyboard is composing a word is never a send.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); };
  const hindi = lang === 'hi-IN';
  const where = voice.mode === 'device' ? 'on this device' : 'audio goes to ' + (voice.consent?.provider ?? 'your browser’s speech service');

  return (
    <form className="composer" onSubmit={submit} aria-label="Send a message">
      {voice.consent && (
        <section className="consent" aria-labelledby="consent-title">
          <h2 id="consent-title">Voice needs one decision from you</h2>
          <p>To turn speech into text, this browser sends your audio to <strong>{voice.consent.provider}</strong>. FraudShield never receives it, and nothing else on this site uses your microphone. If you would rather not, type instead: everything else here stays on your device.</p>
          <div className="consent__actions">
            <button type="button" className="btn btn--primary" onClick={voice.allow}>🎤 Allow voice (audio goes to {voice.consent.provider})</button>
            <button type="button" className="btn" onClick={voice.decline}>⌨️ No, I will type</button>
          </div>
        </section>
      )}
      {voice.notice && (
        <p className="notice" role="status">{voice.notice} <button type="button" className="link-button" onClick={voice.dismiss}>Dismiss</button></p>
      )}
      <div className="composer__row">
        <label htmlFor="message" className="sr-only">Your message</label>
        <textarea
          id="message" ref={box} rows={1} value={draft} maxLength={MAX_LENGTH} enterKeyHint="send" autoComplete="off" autoCorrect="off" spellCheck={false}
          placeholder={voice.listening ? 'Listening… (' + where + ')' : 'Type what happened, paste a message or a link…'}
          onChange={e => onDraft(e.target.value)} onKeyDown={onKey}
          onPaste={e => { const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); onPasteImage(f); } }}
        />
        <button type="button" className="icon-btn" onClick={onAttachClick} aria-label="Attach a screenshot or QR code" title="Attach a screenshot or QR code">📎</button>
        {voice.supported && (
          <>
            <button type="button" className="icon-btn" onClick={() => onLang(hindi ? 'en-IN' : 'hi-IN')} aria-label={'Voice language: ' + (hindi ? 'Hindi' : 'English') + '. Tap to switch to ' + (hindi ? 'English' : 'Hindi')}>{hindi ? 'हिं' : 'EN'}</button>
            <button type="button" className={'icon-btn icon-btn--mic' + (voice.listening ? ' is-live' : '')} onClick={() => { void voice.toggle(); }} aria-pressed={voice.listening} aria-label={voice.listening ? 'Stop listening' : 'Speak your message'}>🎤</button>
          </>
        )}
        <button type="submit" className="btn btn--primary btn--send" disabled={!draft.trim()}>Send</button>
      </div>
      <p className="privacy-line">Checked on your device. What you paste or say here is not sent to any server. <a href="https://github.com/azlanabyssal-cloud/fraudshield/blob/master/docs/PRIVACY.md" target="_blank" rel="noopener">How this works</a></p>
    </form>
  );
}
