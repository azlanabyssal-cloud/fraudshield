import { useState } from 'react';
import type { OpsSummary } from '../../engine/ops';

interface Props { summary: () => OpsSummary; version: number; onErase: () => void; model: { status: 'loading' | 'ready' | 'failed' | 'absent'; retry: () => void } }

const SLO_TEXT: Record<OpsSummary['slo']['status'], string> = { met: 'met', breached: 'breached', 'not-enough-data': 'not enough checks yet' };
const ms = (n: number | null): string => (n === null ? '–' : n < 10 ? n.toFixed(1) + ' ms' : Math.round(n) + ' ms');

/** What the tool did on this device, read back from the counts it keeps (never your words), with a button to copy it and a button to erase it. */
const MODEL_TEXT = { loading: 'loading', ready: 'running', failed: 'could not load: link checks use the written rules only', absent: 'not part of this build' } as const;

export function Diagnostics({ summary, version, onErase, model }: Props) {
  const [copied, setCopied] = useState(false);
  const s = summary();
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(JSON.stringify(s, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };
  return (
    <details className="diagnostics" data-version={version}>
      <summary>How this tool is doing on this device</summary>
      <div className="diagnostics__body">
        <p className="diagnostics__lead">Counts and timings only, kept in this tab. No message, link, number or file name is ever recorded, and nothing is sent anywhere.</p>
        <dl className="stats">
          <div><dt>Checks this session</dt><dd>{s.verdicts}</dd></div>
          <div><dt>Flagged</dt><dd>{s.flaggedShare === null ? '–' : Math.round(s.flaggedShare * 100) + '%'}</dd></div>
          <div><dt>Median / slowest check</dt><dd>{ms(s.latencyMs.p50)} / {ms(s.latencyMs.max)}</dd></div>
          <div><dt>Speed target (95% under 50 ms)</dt><dd>{SLO_TEXT[s.slo.status]}</dd></div>
          <div><dt>Questions answered / not</dt><dd>{s.questions.answered} / {s.questions.unanswered}</dd></div>
          <div><dt>Errors</dt><dd>{Object.values(s.errors).reduce((a, b) => a + b, 0)}</dd></div>
          <div><dt>Domain-name check</dt><dd>{MODEL_TEXT[model.status]}{model.status === 'failed' && <> <button type="button" className="link-button" onClick={model.retry}>Try again</button></>}</dd></div>
        </dl>
        {s.topRules.length > 0 && <p className="diagnostics__rules">Rules that fired most: {s.topRules.slice(0, 5).map(r => r.rule + ' ×' + r.count).join(', ')}</p>}
        <div className="diagnostics__actions">
          <button type="button" className="btn" onClick={() => { void copy(); }}>{copied ? 'Copied' : 'Copy this summary'}</button>
          <button type="button" className="btn btn--danger" onClick={onErase}>Erase everything this tool stored on this device</button>
        </div>
      </div>
    </details>
  );
}
