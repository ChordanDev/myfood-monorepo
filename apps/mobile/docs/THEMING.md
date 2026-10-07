# Theming: every color comes from the active meal palette

The app has no fixed colors. Each meal is assigned a color palette, and the whole
UI re-colors itself to the palette of the meal on screen. Components never know
which palette is active: they ask for a token by its **role** (`colorLight`,
`textDark`, `primaryAccent`) and the palette decides the actual color.

`colorLight` is a light green in one palette and a light red in another. Code
that assumes a hue is wrong by definition.

## Quick path

1. Get the palette: `const { theme } = useRecipeTheme()` from `@/context/RecipeThemeContext`.
2. Pick the token by role, using the [token table](#token-roles).
3. Need a tint? `withOpacity(theme.icon, 0.15)` from `@/utils/colors`. Never a new hex.
4. Color must animate on palette change? `useAnimatedThemeStyle({ backgroundColor: theme.colorDark })` from `@/hooks/useAnimatedThemeStyle`.

```tsx
// Wrong: fixed color, breaks on every other palette
<View style={{ backgroundColor: '#8D9373' }} />

// Wrong: a "close enough" tint invented as a new hex
<View style={{ borderColor: '#4A4D38' }} />

// Right: role token, tint derived from a token
const { theme } = useRecipeTheme();
<View
  style={{
    backgroundColor: theme.colorLight,
    borderColor: withOpacity(theme.icon, 0.3),
  }}
/>
```

## How it works

| Piece           | What it is                                                               | Where                                                       |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Token contract  | `RecipeThemeConfig`: the list of color variables every palette must fill | `src/types/domain.ts`                                       |
| Palette         | One complete set of values for that contract                             | Sent by the backend; mocks carry it as `MasterRecipe.theme` |
| Default palette | Used when no meal palette applies                                        | `DEFAULT_THEME` in `src/context/RecipeThemeContext.tsx`     |
| Active palette  | The single global value all screens read                                 | `RecipeThemeProvider` / `useRecipeTheme()`                  |
| Switching       | `setRecipeTheme(palette \| null)`; `null` falls back to the default      | `src/features/home/hooks/useHomeRecipeTheme.ts`             |

A palette changes the **value** of each variable, never the set of variables.
Switching palettes crossfades every color together in 450 ms.

The same tokens in the two palettes that exist today:

| Token           | Sand (default) | Olive (mock recipes) |
| --------------- | -------------- | -------------------- |
| `colorLight`    | `#A0997E`      | `#8D9373`            |
| `appBg`         | `#E1D8BA`      | `#BCBFA7`            |
| `primaryAccent` | `#E69447`      | `#EF9432`            |
| `icon`          | `#C4BC9C`      | `#D8D98B`            |
| `alert`         | `#B9553B`      | `#C94F3D`            |

## Token roles

Names describe the job a color does, not its hue.

| Token                  | Role                                   | Used today for                                                        |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `appBg`                | Screen ground                          | Screen background; text and icons inside the composer                 |
| `colorBlack`           | Deepest surface                        | Tab bar gradient end, Planner header pills, confirmation card         |
| `colorDark`            | Main dark surface                      | Meal switcher, composer, bottom sheet, Home top fade, dividers at 30% |
| `colorMedium`          | Mid tone between dark and light        | Meal card gradient start, day cell rings, confirmation buttons        |
| `colorLight`           | Light surface sitting on the ground    | Calendar, user chat bubble, settings groups                           |
| `icon`                 | Icons and state tints on dark surfaces | Tab icons, active pill (15% fill + 30% border), planned day (70%)     |
| `primaryAccent`        | Emphasis                               | Selected day (70%), "HOY", Planner header icon and label, ✓ icon      |
| `primaryAccentIntense` | Stronger accent for glows and rings    | Add-button ring, "COMERLO HOY" glow, sheet button borders             |
| `alert`                | Unconfirmed meal, destructive actions  | Pending day cell (70% fill + border), ✗ icon, sign-out row label      |
| `textBlack`            | Body text on light surfaces            | Chat text, day numbers (45% when disabled)                            |
| `textDark`             | Titles and labels on light surfaces    | Screen title, calendar header and weekdays, settings rows             |
| `textMedium`           | Secondary text on dark surfaces        | Active switcher label, weekday on the meal card                       |
| `textLight`            | Primary text on dark surfaces          | Meal description, switcher labels, placeholder (60%)                  |
| `appBgGradient`        | Optional two-stop ground               | Not read by Home or Planner                                           |

If no token fits, do not reach for a literal. Either an existing token at an
opacity solves it, or the contract needs a new token, which is a design
decision that changes every palette.

## What every palette must guarantee

Components pair tokens (text on a surface, a tint over a ground). Hue is free;
these relationships are not.

- **Lightness order:** `colorBlack` ≤ `colorDark` < `colorMedium` < `colorLight` < `appBg`.
- **Dark-on-light pairs** stay readable (4.5:1): `textBlack` and `textDark` on `appBg` and on `colorLight`.
- **Light-on-dark pairs** stay readable (4.5:1): `textLight`, `textMedium`, `icon` and `primaryAccent` on `colorDark` and `colorBlack`; `appBg` on `colorDark`.
- **Selected day:** `textBlack` stays readable on `primaryAccent` at 70% over `colorLight`.
- **Pending day:** `textBlack` stays readable on `alert` at 70% over `colorLight`.
- **Completeness:** all thirteen required tokens are set. The provider back-fills missing ones from the default palette, which silently mixes two palettes.

## Checklist for a new palette

- [ ] All thirteen required tokens defined
- [ ] Lightness order holds
- [ ] The four contrast rules hold
- [ ] Home (with today selected) and Planner both checked with the palette active
- [ ] No component was edited to make the palette work

## Literals that are allowed

| Literal                                                                                                           | Why                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Values inside a palette definition                                                                                | That is where colors live                                           |
| `#000000` as `shadowColor`, `rgba(0, 0, 0, …)` as a modal backdrop                                                | Neutral, independent of the meal                                    |
| The multicolor "thinking" gradient in `ChatComposer`                                                              | Fixed today; treated as palette-independent until decided otherwise |
| Inventory category colors, only in `INVENTORY_CATEGORY_COLORS` (`src/features/inventory/constants/categories.ts`) | A category keeps its color under every palette                      |

Everything else in a component, style or SVG string is a bug.

## Known gaps (2026-10-06)

Existing code that does not follow this rule yet. Do not copy these patterns.

| Where                                            | Problem                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/constants/theme.ts` (`COLORS`, `GRADIENTS`) | Static colors used by auth; its header comment says all colors belong there, which this document supersedes |
| `src/features/home/hooks/useHomeRecipeTheme.ts`  | The meal palette is applied only when today is selected; other days use the default                         |

## Where palettes come from

**The backend owns the palettes.** It decides which palettes exist and which
palette each meal uses (a burger maps to a brown, green and red palette), and
sends that to the app. The frontend only applies what it receives.

| The frontend does                                               | The frontend does not                             |
| --------------------------------------------------------------- | ------------------------------------------------- |
| Define the token contract (`RecipeThemeConfig`)                 | Define a catalog of palettes                      |
| Keep one fallback, `DEFAULT_THEME`, for when no palette applies | Decide which palette a meal gets                  |
| Carry palettes in mocks, as stand-ins for the backend response  | Adjust, derive or "correct" a palette it received |

Adding a palette is a backend change. If a palette looks wrong on screen, the
fix is in the palette data, checked against
[the guarantees above](#what-every-palette-must-guarantee), not in a component.

The token contract is shared with the backend, so changing it is a
cross-project change: update the shared docs first (see
[SHARED_DOCS.md](SHARED_DOCS.md)), then both sides.

## Open decisions

- **Payload shape:** whether each meal arrives with its full palette values, as
  the mocks do today (`MasterRecipe.theme`), or with a palette id plus a
  separate catalog request.
- **Auth:** whether pre-login screens use the default palette or keep their own
  static colors.

Decided: **onboarding** uses the default palette through tokens, like any other
screen. No component or screen under `src/features/onboarding/` carries a color
literal; the only hex values there are the mock palettes of its tests.
