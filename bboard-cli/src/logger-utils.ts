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

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import pinoPretty from 'pino-pretty';
import pino from 'pino';
import { createWriteStream } from 'node:fs';

/**
 * A destination that replaces every secret in each finished log line before passing it
 * on. Scrubbing the serialised line, rather than each argument, also covers child
 * loggers' bindings, Errors and objects that cannot be turned into JSON.
 */
const scrubbing = (secrets: readonly string[], target: { write: (line: string) => unknown }) => ({
  write: (line: string): void => {
    void target.write(secrets.reduce((acc, sec) => acc.split(sec).join('[redacted]'), line));
  },
});

/**
 * A logger for the terminal and a log file. `secrets` (for example an API token carried
 * in a URL) are replaced in everything logged, by this logger and its children, before
 * it reaches either.
 */
export const createLogger = async (logPath: string, secrets: readonly string[] = []): Promise<pino.Logger> => {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const pretty: pinoPretty.PrettyStream = pinoPretty({
    colorize: true,
    sync: true,
  });
  const level =
    process.env.DEBUG_LEVEL !== undefined && process.env.DEBUG_LEVEL !== null && process.env.DEBUG_LEVEL !== ''
      ? process.env.DEBUG_LEVEL
      : 'info';
  const wanted = secrets.filter((x) => x.length > 0);
  return pino(
    { level, depthLimit: 20 },
    pino.multistream([
      { stream: scrubbing(wanted, pretty), level },
      { stream: scrubbing(wanted, createWriteStream(logPath)), level },
    ]),
  );
};
