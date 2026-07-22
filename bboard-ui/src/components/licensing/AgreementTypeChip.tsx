// AgreementTypeChip — shows which kind of agreement this is (license / lab transfer /
// breeder share), wherever an agreement appears.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Chip } from '@mui/material';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import ShareIcon from '@mui/icons-material/ShareOutlined';
import { AGREEMENT_LABEL, type AgreementType } from '../../veilcore/licenses';

const ICON: Record<AgreementType, React.ReactElement> = {
  license: <GavelIcon />,
  'lab-transfer': <ScienceIcon />,
  'breeder-share': <ShareIcon />,
};

const COLOR: Record<AgreementType, 'primary' | 'info' | 'secondary'> = {
  license: 'primary',
  'lab-transfer': 'info',
  'breeder-share': 'secondary',
};

export const AgreementTypeChip: React.FC<{ type: AgreementType; size?: 'small' | 'medium' }> = ({ type, size }) => (
  <Chip
    size={size ?? 'small'}
    variant="outlined"
    color={COLOR[type]}
    icon={ICON[type]}
    label={AGREEMENT_LABEL[type]}
  />
);
