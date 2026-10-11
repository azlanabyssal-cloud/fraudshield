import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => { cleanup(); });
// jsdom has no object URLs either
if (typeof URL !== 'undefined') { URL.createObjectURL = (): string => 'blob:test'; URL.revokeObjectURL = (): void => undefined; }
// jsdom has no layout, so it has no scrolling either
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = (): void => undefined;
