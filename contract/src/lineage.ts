// Lineage compiled-contract module. Mirrors ./veilcore.ts, in its own file for the
// same reason: to avoid `export *` name collisions.
//
// This did not exist while nothing in this repository deployed lineage — the
// contract was compiled here and deployed from the lineage service, so there was
// never a local caller needing the compiled handle.
//
// SPDX-License-Identifier: Apache-2.0

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

import * as CompiledLineageContract from "./managed/lineage/contract/index.js";
import { lineageWitnesses, type LineagePrivateState } from "./witnesses";

export const CompiledLineage = CompiledContract.make<
  CompiledLineageContract.Contract<LineagePrivateState>
>("Lineage", CompiledLineageContract.Contract<LineagePrivateState>).pipe(
  CompiledContract.withWitnesses(lineageWitnesses),
  CompiledContract.withCompiledFileAssets("./managed/lineage"),
);
