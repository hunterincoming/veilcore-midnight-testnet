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
//   - Three failures in a row raise an alert (status endpoint and the log). A budget that
//     is only held by requests still in flight is "busy", not a failure: it frees up within
//     seconds, so it neither counts toward the alert nor clears it.
//   - Its fees come out of the same daily budget as the public endpoint's: one wallet
//     pays both, so one ceiling caps both. A fee above the per-call ceiling, or above
//     what is left today, is not paid.
//   - What the registry says is checked before it costs anything: a root must be 32
//     bytes of hex and not zero, may not repeat another batch's root, and a batch (or a
//     root) this process already recorded is never anchored again, even if a lagging
//     registry still lists it as unanchored.
//   - The public status shows a short outcome code, never raw error text.
//   - The registry must publish exactly this network and contract as where its batches are
//     anchored (/.well-known/veilcore-registry), checked at the start of every run, before
//     anything is sealed, paid or recorded. A preprod sponsor pointed at the mainnet
//     registry would otherwise seal real records into batches and date them on a test
//     network.
//
// Everything outside is behind an interface, so the steps are tested with mocks.
//
// SPDX-License-Identifier: Apache-2.0

import type { FeeBudget } from './limits.js';

export type Batch = { readonly batchId: string; readonly root: string; readonly sealedAt: number; readonly anchored: boolean };

export type AnchorRecord = {
  readonly chain: 'midnight';
  readonly network: string;
  readonly contractAddress: string;
  readonly txHash: string;
  readonly blockHeight: number;
  readonly anchoredAt: string;
};

/** Where a registry says its batch roots are anchored. */
export type PublishedAnchor = { readonly chain: string; readonly network: string; readonly contractAddress: string };

export interface RegistryClient {
  /** Where the registry publishes that its batches are anchored (/.well-known/veilcore-registry). */
  publishedAnchors(): Promise<PublishedAnchor[]>;
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
  /** The fee this transaction pays, in SPECKs. */
  readonly fee: bigint;
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
  /** The most one anchorBatch may cost, in SPECKs. */
  readonly maxFeeSpecks: bigint;
};

/** The outcome of a run, as the public status shows it. The words stay in the log. */
export type AnchorOutcomeCode =
  | 'anchored'
  | 'idle'
  | 'waiting'
  | 'not-sent'
  | 'maybe-sent'
  | 'failed-on-chain'
  | 'expired'
  | 'verify-failed'
  | 'budget'
  | 'busy'
  | 'bad-batch'
  | 'wrong-registry'
  | 'error';

/** What anyone may see: no error text, no transaction or batch in flight. */
export type PublicAnchorerStatus = {
  readonly enabled: true;
  readonly lastRunAt?: string;
  readonly lastOutcome?: AnchorOutcomeCode;
  readonly lastAnchoredBatch?: string;
  readonly alert: boolean;
};

export type AnchorerStatus = {
  readonly lastRunAt?: string;
  readonly lastOutcome?: string;
  readonly lastOutcomeCode?: AnchorOutcomeCode;
  readonly lastAnchoredBatch?: string;
  readonly consecutiveFailures: number;
  readonly alert: boolean;
  readonly inFlight?: { readonly batchId: string; readonly txId: string; readonly stage: string };
};

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, '');
const usableRoot = (h: string): boolean => /^[0-9a-f]{64}$/.test(norm(h)) && !/^0+$/.test(norm(h));

export class Anchorer {
  private lastSealAt: number;
  private failures = 0;
  private status_: { lastRunAt?: string; lastOutcome?: string; lastOutcomeCode?: AnchorOutcomeCode; lastAnchoredBatch?: string } = {};
  /** Batches this process recorded, and their roots: never anchored again. */
  private readonly recordedBatches = new Set<string>();
  private readonly recordedRoots = new Set<string>();

  constructor(
    private readonly config: AnchorerConfig,
    private readonly registry: RegistryClient,
    private readonly chain: AnchorChain,
    private readonly store: AttemptStore,
    /** Runs a job while holding the wallet (one fee payment at a time). */
    private readonly exclusive: <T>(job: () => Promise<T>) => Promise<T>,
    /** The daily budget the public endpoint also pays from. */
    private readonly budget: FeeBudget,
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

  /** The public view: an outcome code and the alert, nothing that came from an error. */
  publicStatus(): PublicAnchorerStatus {
    return {
      enabled: true,
      lastRunAt: this.status_.lastRunAt,
      lastOutcome: this.status_.lastOutcomeCode,
      lastAnchoredBatch: this.status_.lastAnchoredBatch,
      alert: this.failures >= 3,
    };
  }

  /**
   * Record a run's outcome. `ok` true clears the failure count, false adds one; 'neither'
   * (busy for a moment) leaves it as it is, so it can neither raise nor hide the alert.
   */
  private done(code: AnchorOutcomeCode, outcome: string, ok: boolean | 'neither'): string {
    this.status_.lastRunAt = new Date(this.now()).toISOString();
    this.status_.lastOutcome = outcome;
    this.status_.lastOutcomeCode = code;
    if (ok === 'neither') this.log('info', `anchoring: ${outcome}`, { consecutiveFailures: this.failures });
    else if (ok) this.failures = 0;
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
      const mismatch = await this.registryMismatch();
      if (mismatch) return this.done('wrong-registry', mismatch, false);
      const saved = this.store.load();
      if (saved) return await this.resume(saved);

      const target = await this.pickBatch();
      if (!target) return this.done('idle', 'nothing to anchor', true);
      if ('refused' in target) return this.done('bad-batch', target.refused, false);
      return await this.anchor(target);
    } catch (e) {
      return this.done('error', `error: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  /**
   * Why this registry is not one this service may anchor for, or undefined when it is: it
   * must publish exactly one anchor, on this service's chain, network and contract.
   */
  private async registryMismatch(): Promise<string | undefined> {
    const published = await this.registry.publishedAnchors();
    const want = `midnight ${this.config.network} ${norm(this.config.contractAddress)}`;
    const got = published.map((a) => `${a.chain} ${a.network} ${norm(a.contractAddress)}`);
    if (got.length === 1 && got[0] === want) return undefined;
    return got.length === 0
      ? 'the registry publishes no anchor network and contract (set VEILCORE_ANCHOR_NETWORK and VEILCORE_ANCHOR_CONTRACT on it); nothing sealed or sent'
      : `the registry anchors on ${got.join(', ')}, not ${want}; nothing sealed or sent`;
  }

  /** The oldest sealed batch with no anchor, or a newly sealed one when it is time. */
  private async pickBatch(): Promise<{ batchId: string; root: string } | { refused: string } | undefined> {
    const all = await this.registry.batches();
    const waiting = all
      .filter((b) => !b.anchored && !this.recordedBatches.has(b.batchId))
      .sort((a, b) => a.sealedAt - b.sealedAt);
    // A root that another batch also has, or that this process already anchored, is not a
    // new batch root: a broken or hostile registry would be making us pay to write it again.
    const vet = (next: { batchId: string; root: string }): { batchId: string; root: string } | { refused: string } => {
      const twin = all.find((b) => b.batchId !== next.batchId && usableRoot(b.root) && norm(b.root) === norm(next.root));
      if (twin) return { refused: `batch ${next.batchId} has the same root as batch ${twin.batchId}; not anchored` };
      if (this.recordedRoots.has(norm(next.root))) {
        return { refused: `batch ${next.batchId} has a root this service already anchored; not anchored` };
      }
      return next;
    };
    if (waiting.length > 0) return vet(waiting[0]);
    const pending = await this.registry.pendingCount();
    if (pending === 0) return undefined;
    const due = pending >= this.config.sealAtPending || this.now() - this.lastSealAt >= this.config.sealEveryMs;
    if (!due) return undefined;
    const sealed = await this.registry.seal();
    this.lastSealAt = this.now();
    if (!sealed) return undefined;
    this.log('info', 'anchoring: sealed a batch', { batchId: sealed.batchId, records: pending });
    return vet(sealed);
  }

  private async anchor(target: { batchId: string; root: string }): Promise<string> {
    if (!usableRoot(target.root)) {
      return this.done('bad-batch', `batch ${target.batchId} has an unusable root; not anchored`, false);
    }
    const sent = await this.exclusive(async (): Promise<{ attempt: Attempt } | { outcome: string }> => {
      // Hold the most this may cost (or what is left today) before building anything.
      const hold = this.budget.reserveUpTo(this.config.maxFeeSpecks);
      if (hold === undefined) {
        // Nothing free right now. If part of today is unspent, other requests' holds are in
        // the way (each lasts seconds): try next run, and do not count it as a failure.
        if (this.budget.unspent() > 0n) {
          return { outcome: this.done('busy', 'the daily fee budget is held by requests in flight; will try next run', 'neither') };
        }
        return { outcome: this.done('budget', 'the daily fee budget is used up; anchoring waits for tomorrow', false) };
      }
      let prepared: PreparedAnchor;
      let seqBefore: bigint;
      try {
        seqBefore = await this.chain.batchSeq();
        prepared = await this.chain.prepare(norm(target.root));
      } catch (e) {
        this.budget.release(hold.id);
        throw e;
      }
      if (typeof prepared.fee !== 'bigint' || prepared.fee < 0n || prepared.fee > hold.amount) {
        this.budget.release(hold.id);
        await prepared.abandon().catch(() => undefined);
        const fee = typeof prepared.fee === 'bigint' ? prepared.fee : -1n;
        if (fee >= 0n && fee <= this.config.maxFeeSpecks && fee <= this.budget.unspent()) {
          // It would fit what is actually unspent today: only holds in flight are in the way.
          return { outcome: this.done('busy', `anchorBatch for ${target.batchId} waits for budget held by requests in flight; not sent`, 'neither') };
        }
        const why = fee > this.config.maxFeeSpecks ? 'costs more than the per-call ceiling' : 'does not fit what is left of today’s budget';
        return { outcome: this.done('budget', `anchorBatch for ${target.batchId} ${why}; not sent`, false) };
      }
      this.budget.shrink(hold.id, prepared.fee);
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
        this.budget.release(hold.id);
        await prepared.abandon().catch(() => undefined);
        throw e;
      }
      try {
        await prepared.submit();
      } catch (e) {
        if (e instanceof Error && e.name === 'NotSentError') {
          this.budget.release(hold.id);
          this.store.clear();
          await prepared.abandon().catch(() => undefined);
          return { outcome: this.done('not-sent', `not sent (${e.message}); will try again`, false) };
        }
        // It may have reached the network: count the fee, keep the attempt, look it up next time.
        this.budget.settle(hold.id, prepared.fee);
        this.store.save({ ...attempt, stage: 'sent' });
        return { outcome: this.done('maybe-sent', `sending ${prepared.txId} may have failed; will look it up`, false) };
      }
      this.budget.settle(hold.id, prepared.fee);
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
      return this.done('failed-on-chain', `anchorBatch ${a.txId} failed on chain; will build a new one`, false);
    }
    if (landing.state === 'unknown') {
      const expired = this.now() > Date.parse(a.ttl) + this.config.landingGraceMs;
      if (expired) {
        this.store.clear();
        return this.done('expired', `anchorBatch ${a.txId} never landed and has expired; will build a new one`, false);
      }
      return this.done('waiting', `waiting for ${a.txId} to land`, true);
    }

    // Landed. Check the chain says what we meant before telling the registry anything.
    const rootOk = landing.lastBatchRoot !== undefined && norm(landing.lastBatchRoot) === a.root;
    const seqOk = landing.batchSeq !== undefined && landing.batchSeq > BigInt(a.seqBefore);
    if (!rootOk || !seqOk) {
      const tries = (a.verifyTries ?? 0) + 1;
      this.store.save({ ...a, verifyTries: tries });
      return this.done(
        'verify-failed',
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
    this.recordedBatches.add(a.batchId);
    this.recordedRoots.add(norm(a.root));
    this.status_.lastAnchoredBatch = a.batchId;
    this.log('info', 'anchoring: recorded', {
      batchId: a.batchId,
      txHash: a.txHash,
      blockHeight: a.blockHeight,
      paidFeesSpecks: a.paidFees,
    });
    return this.done('anchored', `anchored ${a.batchId} in ${a.txHash}`, true);
  }
}
