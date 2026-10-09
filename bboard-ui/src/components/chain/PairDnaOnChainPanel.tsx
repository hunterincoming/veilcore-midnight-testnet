// After pairing a report: optionally date the pairing on chain against the record's
// anchored identity. What is published is a bound pairing (veilcore/chain/pairing.ts): a
// code made from the report's fingerprint, the identity and a random salt, never the
// fingerprint itself, so nobody watching can copy it to their own record first. The salt
// is saved in this browser (and the backup file) BEFORE the call is sent, and the holder
// downloads an evidence file to keep with the report.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { hexBytes, setDnaOnChain, useRecordKeys, type DnaOnChain } from '../../veilcore/record-keys';
import { getRecord, useRecords } from '../../veilcore/records';
import { CHAIN_CONTRACT, chainNotReady } from '../../veilcore/chain/config';
import { dnaPairBinding, newPairingSalt, pairingEvidence } from '../../veilcore/chain/pairing';
import { useChainCall } from './useChainCall';
import { ChainStatusLine, TxLine } from './ChainStatusLine';

const download = (name: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export const PairDnaOnChainPanel: React.FC<{ recordId: string }> = ({ recordId }) => {
  useRecords();
  const record = getRecord(recordId);
  const keys = useRecordKeys()[recordId];
  const call = useChainCall<void>();
  if (!record?.dnaFingerprint || chainNotReady()) return null;

  if (!keys) {
    return (
      <Typography variant="caption" color="text.secondary">
        This browser does not hold the record’s keys, so it cannot date the pairing. Restore them from your backup.
      </Typography>
    );
  }
  if (!keys.anchor) {
    return (
      <Typography variant="caption" color="text.secondary">
        Anchor the record on the test network first if you also want to date this pairing there.
      </Typography>
    );
  }

  const anchor = keys.anchor;
  const fingerprint = record.dnaFingerprint;
  // Only the report paired now counts: a different file paired since was not dated.
  const mine: DnaOnChain | undefined =
    keys.dnaOnChain?.fingerprint === fingerprint && keys.dnaOnChain.identity === anchor.identity
      ? keys.dnaOnChain
      : undefined;

  const evidenceFile = (d: DnaOnChain): void =>
    download(
      `${recordId}.dna-pairing.json`,
      JSON.stringify(
        pairingEvidence({
          network: anchor.network,
          contractAddress: anchor.contractAddress,
          txId: d.txId ?? '',
          identity: d.identity,
          reportSha256: d.fingerprint,
          salt: d.salt,
          reportFile: record.dnaFileName,
        }),
        null,
        2,
      ) + '\n',
    );

  if (mine?.status === 'paired') {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="body2">This pairing is dated on the test network against this record.</Typography>
          <TxLine label="Pairing" txHash={mine.txHash ?? ''} blockHeight={mine.blockHeight ?? 0} />
          <Typography variant="caption" color="text.secondary">
            To show it, give someone the report and this evidence file. Keep a copy with the report: without its salt
            the pairing can never be shown.
          </Typography>
          {!keys.backedUpAt && (
            <Alert severity="warning" variant="outlined">
              Download the record keys backup again: the one you have does not hold this pairing’s random number.
            </Alert>
          )}
          <Button variant="outlined" onClick={() => evidenceFile(mine)} sx={{ alignSelf: 'flex-start' }}>
            Download the evidence file
          </Button>
        </Stack>
      </Paper>
    );
  }

  const pair = () =>
    call.run(async (progress) => {
      // The same salt again when an earlier send was not confirmed: the same binding, not a second one.
      const pending =
        mine?.status === 'sending'
          ? mine
          : (() => {
              const salt = newPairingSalt();
              const d: DnaOnChain = {
                fingerprint,
                salt,
                identity: anchor.identity,
                binding: dnaPairBinding(fingerprint, anchor.identity, salt),
                status: 'sending',
              };
              setDnaOnChain(recordId, d); // saved before anything is sent
              return d;
            })();
      const { pairDnaOnChain } = await import('../../veilcore/chain/actions');
      const r = await pairDnaOnChain(hexBytes(keys.recordSecret), pending.binding, { progress });
      setDnaOnChain(recordId, {
        ...pending,
        status: 'paired',
        txId: r.txId,
        txHash: r.txHash,
        blockHeight: r.blockHeight,
        at: r.blockTime,
      });
    });

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">Also date this pairing on the test network (optional)</Typography>
        <Typography variant="body2" color="text.secondary">
          This puts a code on chain, permanently, next to this record’s identity. The code is made from the report’s
          fingerprint and a random number kept in this browser, so it says nothing about the report and nobody can copy
          it to their own record. Afterwards you download an evidence file: with it and the report, anyone can check
          that this record’s holder had the report by that date.
        </Typography>
        {mine?.status === 'sending' && (
          <Alert severity="warning" variant="outlined">
            An earlier attempt was sent but not confirmed. It may have landed. Sending again uses the same code, so it
            cannot pair a second, different one.
          </Alert>
        )}
        {mine && !keys.backedUpAt && (
          <Alert severity="warning" variant="outlined">
            Download the record keys backup again: the one you have does not hold this pairing’s random number.
          </Alert>
        )}
        <Button
          variant="outlined"
          disabled={call.busy || !CHAIN_CONTRACT}
          onClick={() => void pair()}
          sx={{ alignSelf: 'flex-start' }}
        >
          {mine?.status === 'sending' ? 'Send again' : 'Date the pairing'}
        </Button>
        <ChainStatusLine busy={call.busy} progress={call.progress} error={call.error} />
        <Typography variant="caption" color="text.secondary">
          Test network only. This shows whoever controlled this record’s identity had the report, or its fingerprint, by
          the date it lands. It is not a check of the genetics.
        </Typography>
      </Stack>
    </Paper>
  );
};
