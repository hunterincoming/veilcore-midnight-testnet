// The facts a holder has chosen to share about a record, as a stranger sees them.
//
// One component renders both the public verify page (from what the registry answered)
// and the holder's preview in step 5 (from the record and the switches), so the preview
// says what the page will say. Facts the holder did not share are named as "not
// shared", never shown as a negative finding: an absent field from the registry means
// the holder did not share it, not "no" (attack round D: "DNA report not yet paired" was
// printed for a record whose holder had paired one and not shared it).
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Divider, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import { shortFingerprint } from '../../veilcore/commitment';
import { DISCLOSURE_FIELDS, GENETICS_LABEL, LEGACY_NAME, keysOn, type Disclosure } from '../../veilcore/disclosure';
import type { StrainRecord } from '../../veilcore/records';
import { TEAL } from '../../config/theme';
import { networkLabel, isTestNetwork } from '../../config/network';
import { displayName } from '../../veilcore/display-name';
import { utcStamp as fmt } from '../../veilcore/time';

// data-fact names what the line is, so a test (or an auditor) can count the ticks.
export const Fact: React.FC<{ ok?: boolean; children: React.ReactNode }> = ({ ok = true, children }) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} data-fact={ok ? 'checked' : 'reported'}>
    {ok ? (
      <CheckCircleIcon sx={{ fontSize: 18, color: TEAL, mt: '2px' }} />
    ) : (
      <CancelIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
    )}
    <Typography variant="body2" sx={{ color: ok ? 'text.primary' : 'text.secondary' }}>
      {children}
    </Typography>
  </Stack>
);

/** What the registry sends for the shared facts (the older key names it answers in). */
export type SharedFactsData = {
  /** The shared keys, in the registry's older names: own, dna, lineage, sealed, parents, method. */
  disclosed: readonly string[];
  /**
   * The registry reports the record's batch anchored, on any network. The prior-possession
   * line is drawn from this and the network, not from `priorPossession`: a current registry
   * sets `priorPossession` only for a mainnet anchor, and a Preview-era anchor must still be
   * shown, as Preview, with its warning.
   */
  anchored?: boolean;
  /** Only for a registry too old to send `anchored`, where it meant "anchored on any network". */
  priorPossession?: boolean;
  anchorNetwork?: string;
  dnaPairedByHolder?: boolean;
  lineageIntact?: boolean | null;
  sealedAt?: number | string;
  registryFirstSeen?: string | null;
  parents?: string[];
  breedingMethod?: string | null;
};

/** The shared facts, then what was not shared, then the genetics row. */
export const SharedFacts: React.FC<{ data: SharedFactsData; preview?: boolean }> = ({ data, preview = false }) => {
  const shared = new Set(data.disclosed);
  const notShared = DISCLOSURE_FIELDS.filter((f) => !shared.has(LEGACY_NAME[f.key])).map((f) => f.label);
  return (
    <Stack spacing={1.25}>
      {shared.has('own') &&
        (preview ? (
          <Fact ok={false}>
            Prior possession: shown only once the registry reports this record&apos;s batch anchored, and then as the
            registry&apos;s report.
          </Fact>
        ) : (data.anchored ?? data.priorPossession) ? (
          <Fact ok={false}>
            Prior possession: the registry reports this record&apos;s batch anchored on{' '}
            {networkLabel(data.anchorNetwork ?? '')}. This page has not checked the chain.
            {isTestNetwork(data.anchorNetwork ?? '')
              ? ' A test network can be reset and its dates carry no evidential weight.'
              : ''}
          </Fact>
        ) : (
          <Fact ok={false}>Prior possession: not anchored yet, so its date rests on this registry&apos;s records.</Fact>
        ))}
      {shared.has('dna') && (
        <Fact ok={false}>
          {data.dnaPairedByHolder
            ? 'The holder paired a DNA report fingerprint with this record. Not confirmed by a lab.'
            : 'The holder has not paired a DNA report with this record.'}
        </Fact>
      )}
      {/* No tick: "intact" is the registry's say-so, and this page walks no descent
          (round D verification). Every line here is a report, never a check. */}
      {shared.has('lineage') &&
        (data.lineageIntact === true ? (
          <Fact ok={false}>
            The registry reports the lineage intact — an unbroken chain back to the sealed record. This page has not
            checked it.
          </Fact>
        ) : (
          <Fact ok={false}>
            Lineage: not checked on this page. The registry does not walk descent for a shared link.
          </Fact>
        ))}
      {shared.has('sealed') && data.sealedAt !== undefined && (
        <Fact ok={false}>
          Sealed, by the holder&apos;s device clock: {fmt(data.sealedAt)}. This is the holder&apos;s own statement.
          {data.registryFirstSeen ? ` First stored by this registry: ${fmt(data.registryFirstSeen)}.` : ''}
        </Fact>
      )}
      {shared.has('parents') && (
        <Fact ok={false}>
          {data.parents?.length
            ? `Parents, as the holder states them: ${data.parents.map(displayName).join(' × ')}`
            : 'No parents recorded.'}
        </Fact>
      )}
      {shared.has('method') && (
        <Fact ok={false}>
          {data.breedingMethod
            ? `Breeding method, as the holder states it: ${displayName(data.breedingMethod)}`
            : 'No breeding method recorded.'}
        </Fact>
      )}

      {shared.size === 0 && (
        <Typography variant="body2" color="text.secondary">
          The holder has shared nothing beyond the basics above.
        </Typography>
      )}

      {notShared.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Not shared by the holder: {notShared.join('; ')}.
        </Typography>
      )}

      <Divider sx={{ my: 0.5 }} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <LockIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
        <Typography variant="body2" color="text.disabled">
          {GENETICS_LABEL}
        </Typography>
      </Stack>
    </Stack>
  );
};

/** The holder's preview: what the verify page will show under these switches. */
export const DisclosedFacts: React.FC<{ record: StrainRecord; disclosure: Disclosure }> = ({ record, disclosure }) => (
  <Stack spacing={1.25}>
    <Typography variant="body2" color="text.secondary">
      Always shown: the cultivar name, the record id, its fingerprint ({shortFingerprint(record.recordFingerprint)}),
      when the registry first stored it, and what this page could check about its batch and any signed attestations.
    </Typography>
    <SharedFacts
      preview
      data={{
        disclosed: keysOn(disclosure).map((k) => LEGACY_NAME[k]),
        dnaPairedByHolder: Boolean(record.dnaFingerprint),
        lineageIntact: null,
        sealedAt: record.loggedAt,
        parents: (record.parents ?? []).map((p) => p.name).filter(Boolean),
        breedingMethod: record.breedingMethod || null,
      }}
    />
  </Stack>
);
