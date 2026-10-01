// Shown when the registry refused part of a save. The app reloads what the registry
// actually holds, so what is on screen matches it; this says what did not go through.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert } from '@mui/material';
import { clearSaveProblem, describeRefusals, useSaveProblem } from '../veilcore/save-status';

export const SaveProblemBar: React.FC = () => {
  const problem = useSaveProblem();
  if (!problem) return null;
  return (
    <Alert severity="warning" variant="outlined" onClose={clearSaveProblem} sx={{ mb: 2 }}>
      The registry did not store some of your {problem.what}, so they have been put back to what it holds:{' '}
      {describeRefusals(problem.refused)}
    </Alert>
  );
};
