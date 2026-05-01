// Design tokens centralizados para toda la aplicacion.
// Cualquier color, espaciado o valor visual repetido debe definirse aqui.

export const COLORS = {
  // --- Fondos principales ---
  bgDarkest: '#111309',
  bgDark: '#191D0D',
  bgMedium: '#242B12',
  bgOlive: '#13160B',
  bgCard: '#1B210E',
  bgGreen: '#364025',

  // --- Superficies claras ---
  surfaceCream: '#E5D8C4',
  surfaceBeige: '#F6ECDE',
  surfaceLight: '#F5F3D4',
  surfaceWarm: '#D6C4B1',

  // --- Acentos ---
  accentYellow: '#D8D98B',
  accentOrange: '#FFB63C',
  accentGreenLight: '#899064',
  accentGreenMuted: '#BCC399',
  accentGreenSoft: '#cbd8aa',

  // --- Texto ---
  textPrimary: '#F7F2E8',
  textLight: '#F5F5F5',
  textDark: '#242B12',
  textMuted: '#4A5130',
  textPlaceholder: '#6F735E',
  textCalendarDay: '#2C2F1D',
  textCalendarDisabled: 'rgba(44, 47, 29, 0.45)',
  textError: '#8A1F1F',

  // --- Bordes ---
  borderDark: '#1C1C1C',
  borderCalendar: '#364025',

  // --- Sombras ---
  shadow: '#000000',

  // --- Transparencias ---
  overlayDark: 'rgba(0, 0, 0, 0.6)',
} as const;

export const GRADIENTS = {
  authLanding: {
    colors: ['#E5D8C4', '#242B12', '#191D0D', '#111309'] as const,
    locations: [0, 0.65, 0.93, 0.98] as const,
  },
  verification: {
    colors: ['#111309', '#191D0D', '#242B12'] as const,
  },
  home: {
    colors: ['#17180E', '#565A41', '#D6C4B1'] as const,
    locations: [0, 0.05, 0.15] as const,
  },
} as const;

export type ColorKey = keyof typeof COLORS;
