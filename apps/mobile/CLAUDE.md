# Project instructions

## Colors come from the active meal palette (MANDATORY)

Every meal has a color palette and the whole UI re-colors to it. Colors are
global variables (`RecipeThemeConfig`); a palette only changes their values.
`colorLight` is light green in one palette and light red in another.

Full reference: [docs/THEMING.md](docs/THEMING.md). Read it before writing or
reviewing any UI code.

- **Never write a color literal** (hex, `rgb()`, named color) in a component, style or SVG string.
- **Read colors from the palette:** `const { theme } = useRecipeTheme()` from `@/context/RecipeThemeContext`.
- **Choose tokens by role, never by hue.** Do not assume `colorLight` is green or `primaryAccent` is orange.
- **Tints are a token at an opacity:** `withOpacity(theme.icon, 0.15)` from `@/utils/colors`. Never a new hex.
- **Animate palette changes** with `useAnimatedThemeStyle` from `@/hooks/useAnimatedThemeStyle`.
- **Do not add, rename or remove a token** without asking: it changes every palette.
- **Palettes come from the backend.** Do not create a palette catalog in the frontend or decide which palette a meal gets. The only palette values in this repo are `DEFAULT_THEME` (fallback) and mocks.
- **Do not edit a component to make one palette look right.** Fix the palette data.
- **Allowed literals:** values inside a palette definition, `#000000` shadows, black modal backdrops, the inventory category colors in `INVENTORY_CATEGORY_COLORS`.
- **Do not copy existing violations.** `docs/THEMING.md` lists the known ones.
