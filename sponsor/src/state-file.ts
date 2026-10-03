// Small JSON files on the service's volume: the anchoring attempt and the day's budget.
// Written to a temporary file and renamed, so a crash mid-write leaves the old file.
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly isValid: (v: unknown) => v is T,
  ) {}

  load(): T | undefined {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch {
      return undefined;
    }
    const parsed: unknown = JSON.parse(text); // a corrupt file is an error, never "nothing saved"
    if (!this.isValid(parsed)) throw new Error(`${this.path} does not hold what this service wrote there`);
    return parsed;
  }

  save(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}
