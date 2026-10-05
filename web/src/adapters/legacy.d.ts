// Typed doors onto the JavaScript modules that have not been ported yet. Each door disappears when its module becomes TypeScript.
declare module '*/lib/msgcheck.js' { import type { MessageApi } from '@/adapters/types'; const api: MessageApi; export default api; }
declare module '*/lib/core.js' { import type { CoreApi } from '@/adapters/types'; const api: CoreApi; export default api; }
