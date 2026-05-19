export interface RecipeTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: [string, string]; // Gradient colors
  text: string;
}

export const RECIPE_THEMES: Record<string, RecipeTheme> = {
  // Tema para platos verdes (ensaladas, pastas con vegetales)
  green: {
    primary: '#364025',
    secondary: '#899064',
    accent: '#D8D98B',
    background: ['#364025', '#1B210E'],
    text: '#F5F3D4',
  },
  // Tema para platos cálidos (pollo, carnes, sopas)
  warm: {
    primary: '#4A2B12',
    secondary: '#D6C4B1',
    accent: '#FFB63C',
    background: ['#241508', '#110904'],
    text: '#F7F2E8',
  },
  // Tema para platos claros (pescados, arroces)
  light: {
    primary: '#D6C4B1',
    secondary: '#E5D8C4',
    accent: '#FFB63C',
    background: ['#2E2A1C', '#13120C'],
    text: '#F5F3D4',
  },
};
