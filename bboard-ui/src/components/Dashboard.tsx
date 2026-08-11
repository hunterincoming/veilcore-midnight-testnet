// Dashboard — the breeder's home once they have records: every strain with its status
// chain and next action, plus demo data portability (export / import / reset).
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
import { useRecords, exportRecords, importRecords, resetDemo } from '../veilcore/records';
import { useLicenses, activeLicenseCount } from '../veilcore/licenses';
import { StatusChain } from './StatusChain';
import { AttentionBar } from './AttentionBar';
import { groupByAttention, attentionSummary, attentionOf, GROUPING_THRESHOLD, type AttentionState } from '../veilcore/attention';
import { TrustPanel } from './TrustPanel';
import { AppHeader } from './AppHeader';
import { TEAL } from '../config/theme';

const MPaper = motion(Paper);
const fmt = (ms: number) => new Date(ms).toLocaleDateString();

export const Dashboard: React.FC = () => {
  const records = useRecords();
  useLicenses();
  const navigate = useNavigate();
  const importRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string>();
  // Per-card "start an agreement" menu — tracks which cultivar it was opened for.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuRecordId, setMenuRecordId] = useState<string>();
  // Which attention state the list is filtered to, or null for everything.
  const [filter, setFilter] = useState<AttentionState | null>(null);

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
      const n = await importRecords(file);
      setToast(`Imported ${n} record${n === 1 ? '' : 's'}.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  const onReset = () => {
    if (window.confirm('Clear all records on this device and start the demo fresh?')) {
      resetDemo();
      setToast('Demo reset.');
    }
  };

  return (
    <Box>
      <AppHeader />

      {records.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: { xs: 6, md: 10 } }}>
          <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.9rem' }, mb: 2 }}>
            Prove you had it{' '}
            <Box component="span" sx={{ color: TEAL }}>
              first.
            </Box>
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mb: 2 }}>
            A tamper-evident record of when you logged a cultivar and what it is — bound to its DNA fingerprint.
            Everything is hashed on your device; your genetics never leave it.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mb: 4 }}>
            Built for breeders and the labs that hold their material. Anyone you send a record to can
            verify it — free, no account, forever. Terms you attach follow the genetics into every
            descendant.
          </Typography>
          <Button component={RouterLink} to="/new" variant="contained" size="large" startIcon={<AddIcon />}>
            Log your first cultivar
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
            <Typography variant="h4">Your cultivars</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button component={RouterLink} to="/new" variant="contained" startIcon={<AddIcon />}>
                New cultivar
              </Button>
              <Button variant="text" startIcon={<DownloadIcon />} onClick={exportRecords}>
                Export
              </Button>
              <Button variant="text" startIcon={<UploadIcon />} onClick={() => importRef.current?.click()}>
                Import
              </Button>
              <Button variant="text" color="inherit" startIcon={<RestartAltIcon />} onClick={onReset}>
                Reset demo
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

          <Stack spacing={1.5}>
            {records
              .filter((r) => (filter === null ? true : attentionOf(r) === filter))
              .map((r) => (
              <MPaper
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => navigate(`/record/${r.id}`)}
                sx={{ p: 2.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
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
                    <Typography variant="caption" color="text.secondary">
                      bred by {r.bredBy} · sealed {fmt(r.loggedAt)} · {r.id}
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
