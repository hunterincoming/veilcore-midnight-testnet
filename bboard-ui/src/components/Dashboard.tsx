// Dashboard (/records) — every record this browser holds, with its status chain and next
// action, plus data portability (export / import / start over). Empty, it is the first
// screen: a breeder is asked to seal a record; a lab is shown its own two jobs, receiving
// material and signing what it confirms (the role picker sends a lab here).
// SPDX-License-Identifier: Apache-2.0

import React, { useRef, useState } from 'react';
import { Box, Button, ListItemIcon, Menu, MenuItem, Paper, Snackbar, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import ShareIcon from '@mui/icons-material/ShareOutlined';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import DownloadIcon from '@mui/icons-material/DownloadOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAltOutlined';
import EastIcon from '@mui/icons-material/East';
import { motion } from 'framer-motion';
import { IS_MAINNET } from '../config/network';
import { useRecords, exportRecords, importRecords, startOver } from '../veilcore/records';
import { holderKeyIfAny, downloadHolderKey } from '../veilcore/holder';
import { useLicenses, activeLicenseCount, clearLoadedLicenses } from '../veilcore/licenses';
import { REAL_CHAIN } from '../veilcore/chain/config';
import { keysWithoutBackup } from '../veilcore/record-keys';
import { StatusChain } from './StatusChain';
import { AttentionBar } from './AttentionBar';
import { RecordFinder, matchesQuery, sortRecords, type SortKey } from './RecordFinder';
import {
  groupByAttention,
  attentionSummary,
  attentionOf,
  GROUPING_THRESHOLD,
  type AttentionState,
} from '../veilcore/attention';
import { TrustPanel } from './TrustPanel';
import { AppHeader } from './AppHeader';
import { OPEN_RECEIVE_EVENT } from './ClaimTransfer';
import { OPEN_SIGNING_KEY_EVENT } from './AttesterSetup';
import InboxIcon from '@mui/icons-material/MoveToInboxOutlined';
import BadgeIcon from '@mui/icons-material/VerifiedUserOutlined';
import { TEAL } from '../config/theme';
import { linkCard } from './a11y';
import { OUR_SERVER } from '../config/copy';
import { useRole, isBreeder, isLab } from '../veilcore/role';
import { loadAttester } from '../veilcore/attester-keys';

const MPaper = motion(Paper);
const fmt = (ms: number) => new Date(ms).toLocaleDateString();

export const Dashboard: React.FC = () => {
  const records = useRecords();
  useLicenses();
  const navigate = useNavigate();
  const role = useRole();
  const importRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string>();
  // Per-card "start an agreement" menu — tracks which cultivar it was opened for.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuRecordId, setMenuRecordId] = useState<string>();
  // Which attention state the list is filtered to, or null for everything.
  const [filter, setFilter] = useState<AttentionState | null>(null);
  // Finding a record is a different question from what needs doing, so it is a
  // different control. Both appear only when there is enough to warrant them.
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  const visible = sortRecords(
    records.filter((r) => (filter === null ? true : attentionOf(r) === filter)).filter((r) => matchesQuery(r, query)),
    sort,
  );

  const openAgreementMenu = (e: React.MouseEvent<HTMLElement>, recordId: string) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuRecordId(recordId);
  };
  const closeAgreementMenu = () => setMenuAnchor(null);
  const startAgreement = (type: string) => {
    if (menuRecordId) navigate(`/record/${menuRecordId}/license?type=${type}`);
    closeAgreementMenu();
  };

  const onImport = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const { added, alreadyHere } = await importRecords(file);
      setToast(
        `Imported ${added} record${added === 1 ? '' : 's'}.` +
          (alreadyHere ? ` ${alreadyHere} already here ${alreadyHere === 1 ? 'was' : 'were'} left as they are.` : ''),
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  // Nothing is deleted anywhere: the records stay on VeilCore's registry under the
  // current key, which is downloaded first so they can be restored (attack round D: this
  // said "clear all records on this device" and saved an empty set to the registry).
  const onReset = () => {
    const key = holderKeyIfAny();
    // Record keys made for on-chain calls (test networks only) live in this browser alone.
    const unsaved = REAL_CHAIN ? keysWithoutBackup().length : 0;
    const keysWarning =
      unsaved > 0
        ? `\n\n${unsaved} record${unsaved === 1 ? ' has' : 's have'} on-chain keys with no backup. They stay in this browser, but download their backups first: clearing the browser later would lose them for good.`
        : '';
    if (
      window.confirm(
        'Start over in this browser with a new, empty set?\n\n' +
          'Nothing is deleted. Your current records stay on VeilCore’s registry under your current holder key, ' +
          'and you can get them back only with that key. It will be downloaded now — keep the file.' +
          keysWarning,
      )
    ) {
      if (key) downloadHolderKey(key);
      startOver();
      clearLoadedLicenses();
      setToast('Started over. Restore your old records any time from the holder key file.');
    }
  };

  return (
    <Box>
      <AppHeader />

      {records.length === 0 && isLab(role) && !isBreeder(role) ? (
        <LabWelcome />
      ) : records.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: { xs: 6, md: 10 } }}>
          <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.9rem' }, mb: 2 }}>
            Prove you had it{' '}
            <Box component="span" sx={{ color: TEAL }}>
              first.
            </Box>
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mb: 2 }}>
            Seal a record of a cultivar you hold. Lab and DNA files are fingerprinted on your device and never leave it;
            the details you type are kept on {OUR_SERVER}.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mb: 4 }}>
            Anyone you send a record to can check it, free and with no account. Terms you attach apply to offspring
            declared from the record; propagation nobody declares isn&apos;t detected.
          </Typography>
          <Button component={RouterLink} to="/new" variant="contained" size="large" startIcon={<AddIcon />}>
            Seal your first record
          </Button>
          <Box sx={{ mt: 6, textAlign: 'left' }}>
            <TrustPanel />
          </Box>
        </Box>
      ) : (
        <>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1 }}
          >
            <Typography variant="h4">Your records</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button component={RouterLink} to="/new" variant="contained" startIcon={<AddIcon />}>
                New record
              </Button>
              <Button variant="text" startIcon={<DownloadIcon />} onClick={exportRecords}>
                Export
              </Button>
              <Button variant="text" startIcon={<UploadIcon />} onClick={() => importRef.current?.click()}>
                Import
              </Button>
              <Button variant="text" color="inherit" startIcon={<RestartAltIcon />} onClick={onReset}>
                Start over
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  onImport(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </Stack>
          </Stack>

          {records.length >= GROUPING_THRESHOLD && (
            <AttentionBar
              summary={attentionSummary(groupByAttention(records))}
              active={filter}
              onSelect={setFilter}
              total={records.length}
            />
          )}

          {records.length >= 5 && (
            <RecordFinder
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={setSort}
              showSearch={records.length >= GROUPING_THRESHOLD}
              matched={visible.length}
              total={records.length}
            />
          )}

          <Stack spacing={1.5}>
            {visible.map((r) => (
              <MPaper
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                {...linkCard(() => navigate(`/record/${r.id}`), `Open ${r.strainName}`)}
                sx={{
                  p: 2.5,
                  cursor: 'pointer',
                  '&:hover, &:focus-visible': { borderColor: 'primary.main', outline: 'none' },
                }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {r.strainName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {r.receivedFrom ? `received from ${r.receivedFrom}` : `bred by ${r.bredBy}`} · sealed{' '}
                      {fmt(r.loggedAt)} · {r.id}
                    </Typography>
                    <Box sx={{ mt: 1 }}>
                      <StatusChain record={r} licenseCount={activeLicenseCount(r.id)} dense />
                    </Box>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<GavelIcon />}
                      endIcon={<ArrowDropDownIcon />}
                      onClick={(e) => openAgreementMenu(e, r.id)}
                    >
                      Agreement
                    </Button>
                    <EastIcon sx={{ color: 'text.secondary' }} />
                  </Stack>
                </Stack>
              </MPaper>
            ))}
          </Stack>
          <Box sx={{ mt: 5 }}>
            <TrustPanel />
          </Box>
        </>
      )}

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeAgreementMenu}>
        <MenuItem onClick={() => startAgreement('license')}>
          <ListItemIcon>
            <GavelIcon fontSize="small" />
          </ListItemIcon>
          License
        </MenuItem>
        <MenuItem onClick={() => startAgreement('lab-transfer')}>
          <ListItemIcon>
            <ScienceIcon fontSize="small" />
          </ListItemIcon>
          Send to a lab
        </MenuItem>
        <MenuItem onClick={() => startAgreement('breeder-share')}>
          <ListItemIcon>
            <ShareIcon fontSize="small" />
          </ListItemIcon>
          Share with a breeder
        </MenuItem>
      </Menu>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(undefined)}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

/** A lab's first screen: its two jobs, before it holds any records. */
const LabWelcome: React.FC = () => (
  <Box sx={{ py: { xs: 4, md: 8 } }}>
    <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.6rem' }, mb: 2, textAlign: 'center' }}>
      Receive material.{' '}
      <Box component="span" sx={{ color: TEAL }}>
        Sign what you confirm.
      </Box>
    </Typography>
    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto', mb: 4, textAlign: 'center' }}>
      A signed record of exactly what arrived, when, and on what terms protects you as much as your client.
    </Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, maxWidth: 760, mx: 'auto' }}>
      <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
        <Typography variant="overline" sx={{ color: TEAL, display: 'block' }}>
          1 · Receive material
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          A client who sends you material through VeilCore gives you a transfer code. Enter it when the material
          arrives: you get your own record of what you received, linked to theirs.
        </Typography>
        <Button
          variant="contained"
          startIcon={<InboxIcon />}
          onClick={() => window.dispatchEvent(new Event(OPEN_RECEIVE_EVENT))}
        >
          Enter a transfer code
        </Button>
      </Paper>
      <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
        <Typography variant="overline" sx={{ color: TEAL, display: 'block' }}>
          2 · Set up your signing key
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          With a signing key, your receipts and reports are signed by you, so they can&apos;t be moved to another record
          or kept on an edited copy, and only you can withdraw them.
        </Typography>
        <Button
          variant="outlined"
          startIcon={<BadgeIcon />}
          onClick={() => window.dispatchEvent(new Event(OPEN_SIGNING_KEY_EVENT))}
        >
          {loadAttester() ? 'See your signing key' : 'Create a signing key'}
        </Button>
      </Paper>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto', mt: 3, textAlign: 'center' }}>
      {IS_MAINNET
        ? "Don't type anything here you need to keep secret. A lab can also sign inside its own systems; the"
        : 'Trying it out? Use made-up details. A lab using VeilCore for real would sign inside its own systems; the'}{' '}
      <Box component={RouterLink} to="/docs/integrate" sx={{ color: TEAL }}>
        integration guide
      </Box>{' '}
      shows how. Holding material of your own?{' '}
      <Box component={RouterLink} to="/new" sx={{ color: TEAL }}>
        Seal a record
      </Box>
      .
    </Typography>
  </Box>
);
