import { useCallback, useEffect, useRef, useState } from 'react';
import { speechProvider } from '../../adapters/analyzers';
import { isIncomplete } from '../../engine/utterance';

// The parts of the browser's speech recogniser this code uses (it is not in the standard type library, and Chrome and Safari name it differently).
interface RecognitionResult { readonly isFinal: boolean; readonly [index: number]: { readonly transcript: string } }
interface RecognitionEvent { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string; interimResults: boolean; maxAlternatives: number; processLocally?: boolean;
  start(): void; stop(): void;
  onresult: ((e: RecognitionEvent) => void) | null; onstart: (() => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
}
interface RecognitionClass { new (): Recognition; available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> }
const recognitionClass = (): RecognitionClass | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const VOICE_CONSENT_KEY = 'fs_voice_consent_v1';
export type VoiceLang = 'en-IN' | 'hi-IN';
/** A half-sentence is held and the microphone reopened for the rest; at most this many times, so it can never loop. */
export const MAX_HOLDS = 2;

export interface VoiceOptions {
  lang: VoiceLang;
  /** Called with the finished sentence. */
  onText: (text: string) => void;
  /** Called with what is being heard right now, to show it as it is spoken. */
  onDraft: (text: string) => void;
}
export interface VoiceState {
  supported: boolean;
  listening: boolean;
  /** Where the audio goes while listening: nowhere (on this device) or to the browser maker's service. */
  mode: 'device' | 'cloud' | null;
  /** A message to show, when something needs saying (blocked microphone, nothing heard, ...). */
  notice: string | null;
  /** Set while the person has to decide where their audio may go; the microphone stays closed until they do. */
  consent: { provider: string } | null;
}

const readConsent = (): boolean => { try { return window.localStorage.getItem(VOICE_CONSENT_KEY) === 'cloud'; } catch { return false; } };
const saveConsent = (): void => { try { window.localStorage.setItem(VOICE_CONSENT_KEY, 'cloud'); } catch { /* the choice then lasts for this visit only */ } };

export function useVoice({ lang, onText, onDraft }: VoiceOptions) {
  const Class = recognitionClass();
  const [state, setState] = useState<VoiceState>({ supported: Class !== null, listening: false, mode: null, notice: null, consent: null });
  const rec = useRef<Recognition | null>(null);
  const mode = useRef<'device' | 'cloud' | null>(null);
  const skipDevice = useRef(false);
  const consentThisVisit = useRef(false);
  const carry = useRef({ text: '', holds: 0, hold: false });
  const handlers = useRef({ onText, onDraft, lang });
  useEffect(() => { handlers.current = { onText, onDraft, lang }; });

  const patch = useCallback((p: Partial<VoiceState>) => setState(s => ({ ...s, ...p })), []);
  const resetCarry = (): void => { carry.current = { text: '', holds: 0, hold: false }; };

  const start = useCallback(() => {
    const r = rec.current;
    if (!r || !mode.current) return;                       // never open the microphone before a mode, and so a consent, exists
    r.lang = handlers.current.lang;
    if ('processLocally' in r) r.processLocally = mode.current === 'device';
    try { r.start(); patch({ listening: true, mode: mode.current, notice: null }); }
    catch (e) { if ((e as { name?: string }).name !== 'InvalidStateError') patch({ notice: 'Voice input could not start. You can still type your message.' }); }
  }, [patch]);

  const ensure = useCallback((): Recognition | null => {
    if (rec.current || !Class) return rec.current;
    const r = new Class();
    r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = e => {
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (!res) continue; const t = res[0]?.transcript ?? ''; if (res.isFinal) final += t; else interim += t; }
      handlers.current.onDraft(final || interim);
      if (!final) return;
      const joined = (carry.current.text + ' ' + final).trim();
      if (isIncomplete(joined) && carry.current.holds < MAX_HOLDS) {
        carry.current = { text: joined, holds: carry.current.holds + 1, hold: true };
        handlers.current.onDraft(joined);
        return;
      }
      resetCarry();
      handlers.current.onText(joined);
    };
    r.onend = () => {
      patch({ listening: false });
      if (carry.current.hold) { carry.current.hold = false; setTimeout(start, 120); }   // the sentence was cut off: keep listening for the rest
    };
    r.onerror = e => {
      patch({ listening: false });
      // Every branch ends in a message and none latches: a denied permission can be fixed in the browser, so the next tap must be allowed to try again.
      switch (e.error) {
        case 'not-allowed': patch({ notice: 'The microphone is blocked. Click the lock icon next to the address bar and allow the microphone for this site (on a Mac also tick your browser under System Settings, Privacy & Security, Microphone). Then tap the microphone again, or just type.' }); break;
        case 'service-not-allowed': patch({ notice: 'Voice recognition is switched off for this browser. On a Mac using Safari, turn on Dictation in System Settings, Keyboard, Dictation, then tap the microphone again. You can still type any time.' }); break;
        case 'language-not-supported': skipDevice.current = true; patch({ notice: "That language isn't available for on-device voice in this browser. Tap the microphone again to use your browser's speech service instead (I will ask first), or type." }); break;
        case 'no-speech': {
          // Nothing more was said after a held, cut-off sentence: answer what there is rather than lose it.
          const held = carry.current.text; resetCarry();
          if (held) { handlers.current.onText(held); break; }
          patch({ notice: "I didn't catch that. Try again, or type your message." }); break;
        }
        case 'audio-capture': patch({ notice: "I can't reach a microphone on this device. Check that nothing else (another app or tab) is using it, or type your message." }); break;
        case 'network': patch({ notice: 'Voice recognition needs an internet connection here. Check your connection and try again, or type your message.' }); break;
        case 'aborted': break;                              // the person or the system stopped it: not a failure
        default: patch({ notice: 'Voice input hit an unexpected problem (' + e.error + '). You can still type your message.' });
      }
    };
    rec.current = r;
    return r;
  }, [Class, patch, start]);

  /** 'device' when the browser can recognise speech locally (nothing leaves), 'cloud' once the person has agreed, otherwise 'ask'. */
  const decide = useCallback(async (): Promise<'device' | 'cloud' | 'ask'> => {
    if (!skipDevice.current && Class && typeof Class.available === 'function') {
      try { if ((await Class.available({ langs: [handlers.current.lang], processLocally: true })) === 'available') return 'device'; } catch { /* not offered here: fall through */ }
    }
    return consentThisVisit.current || readConsent() ? 'cloud' : 'ask';
  }, [Class]);

  const toggle = useCallback(async () => {
    if (!Class) { patch({ notice: "Voice input isn't supported in this browser. It needs Chrome, Edge or Safari. You can still type, or paste a screenshot." }); return; }
    if (state.listening) { resetCarry(); rec.current?.stop(); return; }
    resetCarry();
    const m = await decide();
    if (m === 'ask') { patch({ consent: { provider: speechProvider(navigator.userAgent) }, notice: null }); return; }
    mode.current = m; ensure(); start();
  }, [Class, decide, ensure, patch, start, state.listening]);

  const allow = useCallback(() => { saveConsent(); consentThisVisit.current = true; mode.current = 'cloud'; patch({ consent: null }); ensure(); start(); }, [ensure, patch, start]);
  const decline = useCallback(() => patch({ consent: null, notice: 'Understood. Nothing was recorded. Everything else here stays on your device.' }), [patch]);
  /** Reopen the microphone for the next turn of a spoken conversation (never while the assistant is still speaking). */
  const resume = useCallback(() => { if (mode.current) start(); }, [start]);
  const stop = useCallback(() => { resetCarry(); rec.current?.stop(); }, []);
  const dismiss = useCallback(() => patch({ notice: null }), [patch]);
  // a change of language takes effect on the next start; stop a running session so it does not keep the old one
  useEffect(() => { if (state.listening) { resetCarry(); rec.current?.stop(); } }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, toggle, allow, decline, resume, stop, dismiss };
}
