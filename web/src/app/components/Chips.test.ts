import { describe, expect, test } from 'vitest';
import { plain } from './Chips';

describe('plain: the words of a suggested reply without the emoji it was written with', () => {
  test.each([
    ['📞 Suspicious call (CBI/police/arrest)', 'Suspicious call (CBI/police/arrest)'],
    ['1️⃣ First step', 'First step'],
    ['👨‍👩‍👧 Family asked for money', 'Family asked for money'],
    ['👍🏽 Yes, I paid', 'Yes, I paid'],
    ['Main Menu', 'Main Menu'],
    ['क्या यह सुरक्षित है', 'क्या यह सुरक्षित है'],
    ['📷', '📷']   // nothing but the symbol: keep it rather than render an empty button
  ])('%s', (label, shown) => { expect(plain(label)).toBe(shown); });
});
