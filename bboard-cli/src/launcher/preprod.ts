// This file is part of midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
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

import { createLogger, scrubTerminal } from '../logger-utils.js';
import { run } from '../index.js';
import { PreprodRemoteConfig, blockfrostProjectIdFor } from '../config.js';

const config = new PreprodRemoteConfig();
// Since 9 Oct 2026 preprod is reached through Blockfrost, and the project id travels in
// the endpoint URLs: keep it out of the terminal and the log file, as on mainnet.
const projectId = blockfrostProjectIdFor('preprod');
const logger = await createLogger(config.logDir, [projectId]);
scrubTerminal([projectId]);
const testEnvironment = config.getEnvironment(logger);
await run(config, testEnvironment, logger);
