// Types for slots.mjs, so vite.config.ts, the typecheck and the tests can import it.
// SPDX-License-Identifier: Apache-2.0
import type { Plugin } from 'vite';

export type Slot = {
  readonly name: string;
  readonly file: string;
  readonly anchor: string;
  readonly where: 'before' | 'after' | 'before-box' | 'before-stack';
  readonly code: string;
  readonly imports: readonly string[];
};
export declare const UI_ROOT: string;
export declare const SRC: string;
export declare const PARAMS_DIR: string;
export declare const SLOTS: readonly Slot[];
export declare const SLOT_FILES: readonly string[];
export declare const applySlots: (rel: string, code: string) => string;
export declare const realChainPlugin: () => Plugin;
