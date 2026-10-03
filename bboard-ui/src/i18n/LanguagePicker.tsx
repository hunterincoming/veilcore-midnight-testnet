// The language picker in the header, and the banner over a draft translation.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { LANGUAGES, useI18n, type Lang } from './index';
import { en } from './en';
import { TEAL } from '../config/theme';

export const LanguagePicker: React.FC = () => {
  const { lang, setLang, choices, t } = useI18n();
  if (choices.length < 2) return null;
  return (
    <TextField
      select
      size="small"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      aria-label={t('nav.language')}
      slotProps={{
        select: {
          renderValue: (v) => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <TranslateIcon sx={{ fontSize: 16, color: TEAL }} />
              {LANGUAGES[v as Lang].short}
            </Box>
          ),
        },
      }}
      sx={{ minWidth: 92, '& .MuiSelect-select': { py: 0.75, fontSize: 14 } }}
    >
      {choices.map((l) => (
        <MenuItem key={l} value={l} lang={l}>
          {LANGUAGES[l].label}
        </MenuItem>
      ))}
    </TextField>
  );
};

export const DraftBanner: React.FC = () => {
  const { isDraft, setLang, t, lang } = useI18n();
  if (!isDraft) return null;
  return (
    <Box
      role="note"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.25,
        mb: 3,
        border: '1px solid rgba(255,200,80,0.35)',
        borderRadius: 1,
        background: 'rgba(255,200,80,0.06)',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 220 }}>
        <Typography variant="body2">{t('draft.banner')}</Typography>
        {lang !== 'en' && (
          <Typography variant="caption" color="text.secondary" lang="en">
            {en['draft.banner']}
          </Typography>
        )}
      </Box>
      <Button size="small" variant="outlined" onClick={() => setLang('en')}>
        {t('draft.showEnglish')}
      </Button>
    </Box>
  );
};
