// Copyright (C) VeilCore
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Types and utilities for working with VeilCore contracts.
 *
 * @packageDocumentation
 */

export * as utils from './utils/index.js';

// Exported so a deploy path outside this repository — the lineage service — can
// call the gate at its own deploy site. A guard it cannot reach is a guard that
// sits where the deploy never touches.
export * from './deploy-guard.js';
export * from './veilcore-types.js';
export * from './veilcore-api.js';
export * from './lineage-types.js';
export * from './lineage-api.js';
