import raw from './flows.json';

export interface FlowOption { label: string; goto: string }
export interface FlowCta { label: string; href: string }
/** One step of a guided flow: what the assistant says, and what the person can do next. */
export interface FlowNode { say: string[]; urgent?: boolean; options?: FlowOption[]; cta?: FlowCta[] }
export interface Flow { start: string; nodes: Record<string, FlowNode> }

/** The nine guided flows. The data is the one the site has always used; the shape is now checked by the compiler and by tests. */
export const FLOWS: Readonly<Record<string, Flow>> = raw as Record<string, Flow>;
export const flowNode = (flow: string, node: string): FlowNode | null => FLOWS[flow]?.nodes[node] ?? null;

/** The first things the assistant offers; `goto` is a flow name, or `__checklink__` to ask for a link. */
export const TOP_CHIPS: readonly { label: string; goto: string }[] = [
  { label: '📞 Suspicious call (CBI/police/arrest)', goto: 'Digital Arrest' },
  { label: '🔢 Someone asked for my OTP', goto: 'OTP Scam' },
  { label: '📱 UPI / QR code fraud', goto: 'UPI Fraud' },
  { label: '🔗 Suspicious link or SMS', goto: 'Phishing' },
  { label: '💰 Fake loan app', goto: 'Fake Loan App' },
  { label: '🔒 Being blackmailed with photos', goto: 'Sextortion' },
  { label: '📈 Investment / trading scam', goto: 'Investment Scam' },
  { label: '💼 Fake job offer', goto: 'Job Fraud' },
  { label: '📵 SIM stopped working suddenly', goto: 'SIM Swap' },
  { label: '🔎 Just check a link for me', goto: '__checklink__' }
];
