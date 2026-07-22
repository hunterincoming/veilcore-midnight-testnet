// Dropzone — drag/drop or click to choose the DNA lab report file. The file is only
// read locally by the caller; it is never uploaded.
// SPDX-License-Identifier: Apache-2.0

import React, { useRef, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFileOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import { TEAL } from '../../config/theme';

export const Dropzone: React.FC<{
  onFile: (file: File) => void;
  file?: File | null;
  title: string;
  hint: string;
}> = ({ onFile, file, title, hint }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (f: File | null | undefined) => {
    if (f) onFile(f);
  };

  return (
    <Box
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files?.[0]);
      }}
      sx={{
        cursor: 'pointer',
        borderRadius: 3,
        border: '2px dashed',
        borderColor: over ? TEAL : 'divider',
        background: over ? 'rgba(47,240,207,0.06)' : 'rgba(255,255,255,0.02)',
        p: 4,
        textAlign: 'center',
        transition: 'all 0.2s',
        '&:hover': { borderColor: 'primary.main', background: 'rgba(47,240,207,0.04)' },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {file ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
          <DescriptionIcon sx={{ color: 'primary.main' }} />
          <Box sx={{ textAlign: 'left', minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {file.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {(file.size / 1024).toFixed(0)} KB · ready to fingerprint locally
            </Typography>
          </Box>
        </Stack>
      ) : (
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <UploadFileIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
          <Typography variant="subtitle1">{title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Stack>
      )}
    </Box>
  );
};
