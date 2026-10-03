// The anchoring job: seal pending records into a batch on the registry, put the batch
// root on chain with anchorBatch, check on chain that it landed with that root, and only
// then tell the registry where it was anchored.
//
// Rules this keeps:
//   - A transaction that may still land is never rebuilt or sent again. That would pay
//     two fees and write two roots. The attempt is saved (transaction id, expiry) BEFORE
//     it is sent, so a restart looks it up instead of guessing.
//   - The registry is told about an anchor only after the chain shows lastBatchRoot equal
//     to the batch root, in the state right after that transaction, and batchSeq advanced.
//   - Three failures in a row raise an alert (status endpoint and the log).
//
// Everything outside is behind an interface, so the steps are tested with mocks.
//
// SPDX-License-Identifier: Apache-2.0

export type Batch = { readonly batchId: string; readonly root: string; readonly sealedAt: number; readonly anchored: boolean };

export type AnchorRecord = {
  readonly chain: 'midnight';
  readonly network: string;
  readonly contractAddress: string;
  readonly txHash: string;
  readonly blockHeight: number;
  readonly anchoredAt: string;
};

export interface RegistryClient {
  /** How many sealed records are waiting for a batch. */
  pendingCount(): Promise<number>;
  /** Seal everything pending into a new batch; undefined when nothing is pending. */
  seal(): Promise<{ batchId: string; root: string } | undefined>;
  /** Every batch, newest first or any order. */
  batches(): Promise<Batch[]>;
  /** Record where a batch root was anchored (operator only). */
  recordAnchor(batchId: string, anchor: AnchorRecord): Promise<void>;
}

/** A built, proven, paid transaction not yet sent. */
export interface PreparedAnchor {
  readonly txId: string;
  readonly ttl: Date;
  /** Send it. Throws NotSentError when nothing reached the network. */
  submit(): Promise<void>;
  /** Do not send it; release anything the wallet set aside for it. */
  abandon(): Promise<void>;
}

export type Landing =
  | { readonly state: 'unknown' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'landed';
      readonly txHash: string;
      readonly blockHeight: number;
      readonly blockTime?: number;
      /** From the contract state right after this transaction; undefined if it had no single anchorBatch call. */
      readonly lastBatchRoot?: string;
      readonly batchSeq?: bigint;
      /** The fee the network charged, in SPECKs, as the indexer reports it. */
      readonly paidFees?: string;
    };

export interface AnchorChain {
  /** batchSeq in the latest contract state. */
  batchSeq(): Promise<bigint>;
  /** Build, prove and pay for anchorBatch(root). Nothing is sent. */
  prepare(rootHex: string): Promise<PreparedAnchor>;
  /** What the indexer knows about a transaction. */
  lookup(txId: string): Promise<Landing>;
}

export type Attempt = {
  readonly batchId: string;
  readonly root: string;
  readonly txId: string;
  /** ISO time after which the transaction can no longer land. */
  readonly ttl: string;
  readonly seqBefore: string;
  readonly stage: 'sending' | 'sent' | 'verified';
  readonly txHash?: string;
  readonly blockHeight?: number;
  readonly anchoredAt?: string;
  readonly paidFees?: string;
  readonly verifyTries?: number;
};

export interface AttemptStore {
  load(): Attempt | undefined;
  save(a: Attempt): void;
  clear(): void;
}

export type AnchorerConfig = {
  readonly network: string;
  readonly contractAddress: string;
  /** Seal at least this often when anything is pending. */
  readonly sealEveryMs: number;
  /** Seal straight away once this many records are pending. */
  readonly sealAtPending: number;
  /** How long past a transaction's expiry to keep looking for it before trying again. */
  readonly landingGraceMs: number;
  /** How long one run waits for a sent transaction to show up before leaving it to the next run. */
  readonly waitForLandingMs: number;
  readonly pollMs: number;
};

export type AnchorerStatus = {
  readonly lastRunAt?: string;
  readonly lastOutcome?: string;
  readonly lastAnchoredBatch?: string;
  readonly consecutiveFailures: number;
  readonly alert: boolean;
  readonly inFlight?: { readonly batchId: string; readonly txId: string; readonly stage: string };
};

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, '');

export class Anchorer {
  private lastSealAt: number;
  private failures = 0;
  private status_: { lastRunAt?: string; lastOutcome?: string; lastAnchoredBatch?: string } = {};

  constructor(
    private readonly config: AnchorerConfig,
    private readonly registry: RegistryClient,
    private readonly chain: AnchorChain,
    private readonly store: AttemptStore,
    /** Runs a job while holding the wallet (one fee payment at a time). */
    private readonly exclusive: <T>(job: () => Promise<T>) => Promise<T>,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void,
  ) {
    this.lastSealAt = now();
  }

  status(): AnchorerStatus {
    const a = this.store.load();
    return {
      ...this.status_,
      consecutiveFailures: this.failures,
      alert: this.failures >= 3,
      inFlight: a ? { batchId: a.batchId, txId: a.txId, stage: a.stage } : undefined,
    };
  }

  private done(outcome: string, ok: boolean): string {
    this.status_.lastRunAt = new Date(this.now()).toISOString();
    this.status_.lastOutcome = outcome;
    if (ok) this.failures = 0;
    else {
      this.failures++;
      this.log(this.failures >= 3 ? 'error' : 'warn', `anchoring: ${outcome}`, { consecutiveFailures: this.failures });
    }
    return outcome;
  }

  /**
   * One run. Returns a short description of what happened. Never throws: every failure
   * is counted and reported, and the next run picks up from the saved attempt.
   */
  async runOnce(): Promise<string> {
    try {
      const saved = this.store.load();
      if (saved) return await this.resume(saved);

      const target = await this.pickBatch();
      if (!target) return this.done('nothing to anchor', true);
      return await this.anchor(target);
    } catch (e) {
      return this.done(`error: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  /** The oldest sealed batch with no anchor, or a newly sealed one when it is time. */
  private async pickBatch(): Promise<{ batchId: string; root: string } | undefined> {
    const waiting = (await this.registry.batches()).filter((b) => !b.anchored).sort((a, b) => a.sealedAt - b.sealedAt);
    if (waiting.length > 0) return waiting[0];
    const pending = await this.registry.pendingCount();
    if (pending === 0) return undefined;
    const due = pending >= this.config.sealAtPending || this.now() - this.lastSealAt >= this.config.sealEveryMs;
    if (!due) return undefined;
    const sealed = await this.registry.seal();
    this.lastSealAt = this.now();
    if (sealed) this.log('info', 'anchoring: sealed a batch', { batchId: sealed.batchId, records: pending });
    return sealed;
  }

  private async anchor(target: { batchId: string; root: string }): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(norm(target.root)) || /^0+$/.test(norm(target.root))) {
      return this.done(`batch ${target.batchId} has an unusable root; not anchored`, false);
    }
    const sent = await this.exclusive(async (): Promise<{ attempt: Attempt } | { outcome: string }> => {
      const seqBefore = await this.chain.batchSeq();
      const prepared = await this.chain.prepare(norm(target.root));
      const attempt: Attempt = {
        batchId: target.batchId,
        root: norm(target.root),
        txId: prepared.txId,
        ttl: prepared.ttl.toISOString(),
        seqBefore: seqBefore.toString(),
        stage: 'sending',
      };
      try {
        this.store.save(attempt);
      } catch (e) {
        // Without a saved attempt a restart could send it twice. Do not send.
        await prepared.abandon().catch(() => undefined);
        throw e;
      }
      try {
        await prepared.submit();
      } catch (e) {
        if (e instanceof Error && e.name === 'NotSentError') {
          this.store.clear();
          await prepared.abandon().catch(() => undefined);
          return { outcome: this.done(`not sent (${e.message}); will try again`, false) };
        }
        // It may have reached the network: keep the attempt, look it up next time.
        this.store.save({ ...attempt, stage: 'sent' });
        return { outcome: this.done(`sending ${prepared.txId} may have failed; will look it up`, false) };
      }
      return { attempt };
    });
    if ('outcome' in sent) return sent.outcome;
    const { attempt } = sent;
    this.store.save({ ...attempt, stage: 'sent' });
    this.log('info', 'anchoring: sent anchorBatch', { batchId: attempt.batchId, txId: attempt.txId });
    return this.resume({ ...attempt, stage: 'sent' }, true);
  }

  private async resume(a: Attempt, justSent = false): Promise<string> {
    if (a.stage === 'verified') return this.record(a);

    // 'sending' after a restart means it may or may not have gone out: same as 'sent'.
    const deadline = this.now() + (justSent ? this.config.waitForLandingMs : 0);
    let landing = await this.chain.lookup(a.txId);
    while (landing.state === 'unknown' && this.now() < deadline) {
      await this.sleep(this.config.pollMs);
      landing = await this.chain.lookup(a.txId);
    }

    if (landing.state === 'failed') {
      this.store.clear();
      return this.done(`anchorBatch ${a.txId} failed on chain; will build a new one`, false);
    }
    if (landing.state === 'unknown') {
      const expired = this.now() > Date.parse(a.ttl) + this.config.landingGraceMs;
      if (expired) {
        this.store.clear();
        return this.done(`anchorBatch ${a.txId} never landed and has expired; will build a new one`, false);
      }
      return this.done(`waiting for ${a.txId} to land`, true);
    }

    // Landed. Check the chain says what we meant before telling the registry anything.
    const rootOk = landing.lastBatchRoot !== undefined && norm(landing.lastBatchRoot) === a.root;
    const seqOk = landing.batchSeq !== undefined && landing.batchSeq > BigInt(a.seqBefore);
    if (!rootOk || !seqOk) {
      const tries = (a.verifyTries ?? 0) + 1;
      this.store.save({ ...a, verifyTries: tries });
      return this.done(
        `anchorBatch ${a.txId} landed but the chain does not show root ${a.root.slice(0, 12)}… after it ` +
          `(root ${rootOk ? 'ok' : 'differs'}, batchSeq ${seqOk ? 'ok' : 'did not advance'}); NOT recorded (check ${tries})`,
        false,
      );
    }
    const verified: Attempt = {
      ...a,
      stage: 'verified',
      txHash: norm(landing.txHash),
      blockHeight: landing.blockHeight,
      anchoredAt: new Date(landing.blockTime ?? this.now()).toISOString(),
      paidFees: landing.paidFees,
    };
    this.store.save(verified);
    return this.record(verified);
  }

  private async record(a: Attempt): Promise<string> {
    await this.registry.recordAnchor(a.batchId, {
      chain: 'midnight',
      network: this.config.network,
      contractAddress: this.config.contractAddress,
      txHash: a.txHash ?? '',
      blockHeight: a.blockHeight ?? 0,
      anchoredAt: a.anchoredAt ?? new Date(this.now()).toISOString(),
    });
    this.store.clear();
    this.status_.lastAnchoredBatch = a.batchId;
    this.log('info', 'anchoring: recorded', {
      batchId: a.batchId,
      txHash: a.txHash,
      blockHeight: a.blockHeight,
      paidFeesSpecks: a.paidFees,
    });
    return this.done(`anchored ${a.batchId} in ${a.txHash}`, true);
  }
}
