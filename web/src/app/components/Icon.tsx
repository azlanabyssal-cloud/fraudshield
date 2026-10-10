/** One small icon set, drawn on a 24-unit grid with a 1.75 stroke so every control looks like it belongs to the same family. They are decoration: the control's own text or aria-label names it. */
const PATHS = {
  shield: 'M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z',
  paperclip: 'M20 11.5l-8.2 8.2a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  stop: 'M7 7h10v10H7z',
  send: 'M12 19V5M5 12l7-7 7 7',
  volume: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  volumeOff: 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  octagon: 'M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7L8.5 3zM12 8v5M12 16.5v.01',
  triangle: 'M12 4l9 16H3L12 4zM12 10v4M12 17v.01',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01',
  check: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 9.5',
  file: 'M7 3h7l5 5v13H7V3zM14 3v5h5M10 13h6M10 17h6',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M4 18h16M12 3v2M4.5 6.5l1.4 1.4M19.5 6.5l-1.4 1.4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z',
  lock: 'M6 11h12v9H6v-9zM8.5 11V8a3.5 3.5 0 0 1 7 0v3'
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
