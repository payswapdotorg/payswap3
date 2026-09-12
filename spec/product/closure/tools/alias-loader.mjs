/**
 * UI-010 evidence tooling — Node loader hook resolving the product layer's
 * `@/` path alias (tsconfig paths: `@/*` → `src/*`) for plain-Node
 * execution. The product port modules (src/lib/protocol/*-port.ts) import
 * through `@/lib/...`; plain Node has no tsconfig awareness, so this
 * resolver maps the alias onto the repository's src/ tree. TypeScript type
 * stripping is native in Node ≥ 23.6 (Node 24.19 here), so .ts modules
 * import directly.
 *
 * Registered via: node --import ./alias-loader.mjs <script.mjs>
 */
import { register } from 'node:module';

register(new URL('./alias-resolver.mjs', import.meta.url));
