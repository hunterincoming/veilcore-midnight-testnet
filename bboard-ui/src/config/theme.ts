// Veilcore brand theme: bioluminescent teal on near-black.
// SPDX-License-Identifier: Apache-2.0

import { createTheme, alpha } from '@mui/material';

// Signature accent — a bioluminescent teal evoking genetics + a privacy "veil".
export const TEAL = '#2ff0cf';
export const TEAL_DIM = '#12b39a';
const INK = '#04070a'; // near-black canvas
const PANEL = '#0a1114'; // raised surface
const TEXT = '#e7f4f1';
const MUTED = '#7f9a95';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: TEAL,
      light: '#69f6de',
      dark: TEAL_DIM,
      contrastText: '#02110d',
    },
    secondary: {
      main: '#8a7dff', // restrained violet complement, used sparingly
    },
    background: {
      default: INK,
      paper: PANEL,
    },
    text: {
      primary: TEXT,
      secondary: MUTED,
    },
    success: { main: TEAL },
    error: { main: '#ff5c72' },
    divider: alpha('#2ff0cf', 0.14),
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Inter", system-ui, sans-serif',
    h1: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, letterSpacing: '-0.02em' },
    h3: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, letterSpacing: '-0.01em' },
    h4: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600 },
    h5: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 500 },
    h6: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 500, letterSpacing: '0.01em' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
    allVariants: { color: TEXT },
    overline: { letterSpacing: '0.28em', color: MUTED },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${alpha(TEAL, 0.12)}`,
          backgroundColor: PANEL,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          paddingInline: 22,
          paddingBlock: 10,
          '&.MuiButton-containedPrimary': {
            boxShadow: `0 0 0 1px ${alpha(TEAL, 0.5)}, 0 8px 30px ${alpha(TEAL, 0.25)}`,
          },
          '&.MuiButton-containedPrimary:hover': {
            boxShadow: `0 0 0 1px ${TEAL}, 0 10px 40px ${alpha(TEAL, 0.4)}`,
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#00120f', 0.5),
          '& fieldset': { borderColor: alpha(TEAL, 0.2) },
          '&:hover fieldset': { borderColor: alpha(TEAL, 0.45) },
        },
        input: { color: TEXT, fontFamily: '"Space Grotesk", monospace' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 600, letterSpacing: '0.02em' },
      },
    },
  },
});
