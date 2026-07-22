// Veilcore compiled-contract module. Mirrors ./index.ts (bboard) but for the
// veilcore contract, in its own file to avoid `export *` name collisions.
// SPDX-License-Identifier: Apache-2.0

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

import * as CompiledVeilcoreContract from "./managed/veilcore/contract/index.js";
import { veilcoreWitnesses, type VeilcorePrivateState } from "./witnesses";

export const CompiledVeilcore = CompiledContract.make<
  CompiledVeilcoreContract.Contract<VeilcorePrivateState>
>("Veilcore", CompiledVeilcoreContract.Contract<VeilcorePrivateState>).pipe(
  CompiledContract.withWitnesses(veilcoreWitnesses),
  CompiledContract.withCompiledFileAssets("./managed/veilcore"),
);
