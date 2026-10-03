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
import { TEAL } from '../config/theme';
import { NETWORK, explorerFor, isTestNetwork, networkLabel } from '../config/network';

export const SettlementStatus: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [state, setState] = useState<ProofState>({ status: 'none' });

  useEffect(() => {
    void proofFor(record.recordFingerprint).then(setState);
  }, [record.recordFingerprint]);

  if (state.status === 'none') {
    return (
      <Stack spacing={1}>
        <Typography variant="overline" sx={{ display: 'block' }}>
          Settlement
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Sealed on your device and held on VeilCore&apos;s test server. No batch proof was found for it yet, so it is
          not anchored. Records are anchored together, in batches, by our operator, so one transaction covers many and
          you never need a wallet. Until then its date rests on this registry&apos;s records.
        </Typography>
      </Stack>
    );
  }

  const { proof } = state;
  const anchored = state.status === 'anchored';
  // The proof names its own network; fall back to this build's only if it does not.
  const network = proof.anchor?.network ?? NETWORK;
  const explorer = explorerFor(network);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="overline">Settlement</Typography>
        <Chip
          size="small"
          variant="outlined"
          color={anchored ? 'primary' : 'default'}
          label={anchored ? `Anchored on ${networkLabel(network)}` : 'Batched, not yet anchored'}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {anchored
          ? `This record is part of a batch whose root is recorded on ${networkLabel(network)}. The proof below shows the path from your record to that root, and anyone can check it without asking us.${
              isTestNetwork(network) ? ' A test network can be reset and its dates carry no evidential weight.' : ''
            }`
          : 'This record is in a sealed batch that has not been anchored yet. When the batch root is anchored, this proof gains a reference to the transaction. Nothing about your record changes.'}
      </Typography>

      <Box sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
        <div>batch {proof.batchId}</div>
        <div>root {proof.root.slice(0, 32)}…</div>
        {anchored && proof.anchor?.txHash && (
          <div style={{ color: TEAL, wordBreak: 'break-all' }}>tx {proof.anchor.txHash}</div>
        )}
      </Box>

      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => downloadProof(proof, record.id)}
        >
          Download proof
        </Button>
        {anchored && proof.anchor?.txHash && explorer && (
          <Button size="small" variant="text" startIcon={<LinkIcon />} href={explorer} target="_blank" rel="noopener">
            Open the {network} explorer
          </Button>
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Keep this proof. Checking it needs the open-source package and a lookup on the network, not this site.
      </Typography>
    </Stack>
  );
};
