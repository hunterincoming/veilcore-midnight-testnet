// What happened to this record, in order.
//
// A dispute is a question about sequence: what was held, when, who confirmed it, what
// changed and when. The app has all of that spread across separate panels, which means
// the one view a dispute actually needs does not exist.
//
// Nothing here is new information. It is the same facts, ordered.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { attestationsFor, strengthLabel } from '../veilcore/attesters';
import { proofFor } from '../veilcore/proofs';
import type { StrainRecord } from '../veilcore/records';
import { TEAL } from '../config/theme';
import { utcStamp } from '../veilcore/time';

type Event = { at: number; title: string; detail: string; strong?: boolean };

export const RecordHistory: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [events, setEvents] = useState<Event[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: Event[] = [];

      out.push({
        at: record.loggedAt,
        title: 'Sealed',
        detail: record.supersedes
          ? `Issued as a correction to ${record.supersedes.recordId}. Reason given: ${record.supersedes.reason}.`
          : 'The holder committed to a description of this material, dated by the sealing device’s clock.',
      });

      if (record.receivedAt && record.receivedFrom) {
        out.push({
          at: record.receivedAt,
          title: 'Received',
          detail: `Arrived through a transfer from ${record.receivedFrom}${record.quantity ? `, ${record.quantity}` : ''}.`,
        });
      }

      const atts = await attestationsFor(record.recordFingerprint);
      for (const a of atts) {
        const s = strengthLabel(a);
        out.push({ at: new Date(a.issuedAt).getTime(), title: s.label, detail: s.why, strong: s.ok });
        if (a.retraction) {
          out.push({
            at: new Date(a.retraction.retractedAt).getTime(),
            title: 'Attestation retracted',
            detail: `The attester withdrew it with a retraction signed by their key. Reason: ${a.retraction.reason}. The attestation remains on record — retraction is not deletion.`,
          });
        }
      }

      const proof = await proofFor(record.recordFingerprint);
      // Only a proof checked here (bound to this record, path folding to its root) is
      // listed, and the anchor in it is the registry's report: this page has not looked
      // the transaction up, so it is not presented as fixing the date.
      if (proof.status === 'anchor-reported' && proof.proof.anchor?.anchoredAt) {
        out.push({
          at: new Date(proof.proof.anchor.anchoredAt).getTime(),
          title: 'Anchor reported by the registry',
          detail: `Included in batch ${proof.proof.batchId} (inclusion checked in this browser). The registry reports the batch root was recorded on ${proof.proof.anchor.chain} ${proof.proof.anchor.network}; this page has not checked the chain, so look the transaction up before relying on the date.`,
        });
      }

      if (record.supersededBy) {
        out.push({
          at: Date.now(),
          title: 'Corrected',
          detail: 'A later record supersedes this one. This record is unchanged and remains on file.',
        });
      }

      if (!cancelled) setEvents(out.sort((a, b) => a.at - b.at));
    })();
    return () => {
      cancelled = true;
    };
  }, [record]);

  if (!events || events.length <= 1) return null;

  return (
    <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
      <Stack spacing={0}>
        <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
          History
        </Typography>
        {events.map((e, i) => (
          <Box
            key={i}
            sx={{
              position: 'relative',
              pl: 2.5,
              ml: 0.5,
              pb: i === events.length - 1 ? 0 : 2.5,
              borderLeft: i === events.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                left: -4.5,
                top: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: e.strong ? TEAL : 'rgba(255,255,255,0.3)',
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {e.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {utcStamp(e.at)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {e.detail}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
};
