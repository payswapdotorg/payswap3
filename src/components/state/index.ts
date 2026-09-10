/**
 * State display primitives — public barrel (UI-001).
 *
 * Surfaces import their state rendering from here; they never assemble
 * state visuals from the internal frame directly. This keeps the six
 * display states, their mandatory content, and their visual grammar
 * defined exactly once for the whole product.
 */

export * from './display-state';
export * from './state-icons';
export * from './succeeded-state';
export * from './failed-state';
export * from './unknown-state';
export * from './waiting-state';
export * from './in-progress-state';
export * from './action-required-state';
export * from './availability-unknown-state';
export * from './state-announcer';
