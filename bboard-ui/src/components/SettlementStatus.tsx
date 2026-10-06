// Where this record's commitment actually sits.
//
// Three honest states, per record, rather than one blanket claim about the whole app:
// not yet batched, batched and awaiting an anchor, or anchored on chain with a
// transaction you can look up.
//
// The proof is downloadable because it is the holder's, not ours. They can verify it
// with the published package and a chain lookup, without this registry. Network names
// come from the proof itself or the build's config (config/network.ts), never a
// hard-coded network.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import LinkIcon from '@mui/icons-material/LaunchOutlined';
import { proofFor, downloadProof, type ProofState } from '../veilcore/proofs';
import type { StrainRecord } from '../veilcore/records';
import { NETWORK, explorerFor, isTestNetwork, networkLabel } from '../config/network';
import { OUR_SERVER } from '../config/copy';

export const SettlementStatus: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [state, setState] = useState<ProofState>({ status: 'none' });

  useEffect(() => {
    void proofFor(record.recordFingerprint).then(setState);
  }, [record.recordFingerprint]);

  if (state.status === 'none') {
    return (
      <Stack spacing={1}>
        <Typography variant="overline" sx={{ display: 'block' }}>
          Date on Midnight
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Sealed on your device and kept on {OUR_SERVER}. It isn&apos;t in a batch yet, so it isn&apos;t anchored. We
          anchor records together, in batches (by hand for now, so it can take a while), so one transaction covers many
          and you never need a wallet. Until then its date rests on this registry&apos;s records.
        </Typography>
      </Stack>
    );
  }

  const { proof } = state;
  const reported = state.status === 'anchor-reported';
  // The proof names its own network; fall back to this build's only if it does not.
  const network = proof.anchor?.network ?? NETWORK;
  const explorer = explorerFor(network);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="overline">Date on Midnight</Typography>
        {/* Never "Anchored": this page checks that the record is in the batch, not that
            the batch root is on a chain (attack round D). */}
        <Chip
          size="small"
          variant="outlined"
          label={reported ? `In a batch · anchor reported on ${networkLabel(network)}` : 'In a batch, not yet anchored'}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {reported
          ? `Checked in this browser: your record's fingerprint is in batch ${proof.batchId}, and the path from it folds to the batch root. The registry reports that root was recorded on ${networkLabel(network)}; this page has not looked the transaction up, so it is not shown as anchored. Look it up on the network before relying on the date.${
              isTestNetwork(network) ? ' A test network can be reset and its dates carry no evidential weight.' : ''
            }`
          : `Checked in this browser: your record's fingerprint is in batch ${proof.batchId}, which has not been anchored yet. When it is, the proof gains a reference to the transaction. Nothing about your record changes.`}
      </Typography>

      <Box sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
        <div>batch {proof.batchId}</div>
        <div>root {proof.root.slice(0, 32)}…</div>
        {reported && proof.anchor?.txHash && (
          <div style={{ wordBreak: 'break-all' }}>tx (reported by the registry) {proof.anchor.txHash}</div>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => downloadProof(proof, record.id)}
        >
          Download inclusion proof
        </Button>
        {reported && proof.anchor?.txHash && explorer && (
          <Button size="small" variant="text" startIcon={<LinkIcon />} href={explorer} target="_blank" rel="noopener">
            Open the {networkLabel(network)} explorer
          </Button>
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary">
        The file shows your record is in this batch. It is evidence of a date only once the batch root is found in the
        named transaction, which needs the open-source package and a lookup on the network, not this site.
      </Typography>
    </Stack>
  );
};
