# Screen designs

Static mockups of the app's screens, exported from the design canvas
[Home & Planner Aesthetic](https://claude.ai/artifact/FmQAsje7Lgs5ncLypo7wyZ).
The canvas is the editable source; this folder is the snapshot the issues and
implementation refer to.

Every color in these files is a literal only because they are mockups. In the
app, the same colors come from the active meal palette: see
[THEMING.md](../THEMING.md) before implementing anything here.

## Files

| File                                    | Screen                                                          | Status               |
| --------------------------------------- | --------------------------------------------------------------- | -------------------- |
| `screens/Main.dc.html`                  | Foundations sheet: palettes, type, shape, depth, states, motion | Reference            |
| `screens/Home-Today.dc.html`            | Home with today selected (olive recipe palette)                 | As built             |
| `screens/Home-OtherDay.dc.html`         | Home with another day selected (sand default palette)           | As built             |
| `screens/Planner.dc.html`               | Planner conversation                                            | As built             |
| `screens/Planner-Thinking.dc.html`      | Planner while the assistant answers                             | As built             |
| `screens/Compras.dc.html`               | Shopping list, grouped by category, best price per supermarket  | Proposal             |
| `screens/Inventario.dc.html`            | Inventory, grouped by category, voice input                     | Proposal             |
| `screens/Home-Pendiente.reference.webp` | Home when a past meal was never confirmed as cooked             | Reference screenshot |
| `screens/Ajustes.dc.html`               | Settings / profile                                              | Proposal             |
| `screens/Onboarding.dc.html`            | Onboarding, step 1 of 3                                         | Proposal             |
| `screens/Receta.dc.html`                | Recipe, top of the screen                                       | Proposal             |
| `screens/Receta-Chat.dc.html`           | Recipe, scrolled to the AI chat                                 | Proposal             |
| `screens/canvas.json`                   | Canvas index: artboard sizes and positions                      | Reference            |

## Reading the mockups

- Each `.dc.html` is a 390×844 phone frame (1800×1320 for the Foundations
  sheet). The markup is plain HTML with inline styles; open it in a browser or
  read the values directly.
- `/_blob/…` URLs are assets stored in the canvas and do not resolve here. They
  are the paper grain (`assets/noisy-background.jpg`) and the food photo
  (`assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png`).
- `./support.js` and the `<x-dc>` / `data-dc-script` wrapper belong to the
  canvas runtime. Ignore them.
- Fixed values that matter for implementation (safe areas of 47 / 34, tab bar
  60 + bottom inset, composer 72 → 312, radii, shadows) are listed on the
  Foundations sheet and in `THEMING.md`.

## Decisions carried by these designs

- The `alert` token (sand `#B9553B`, olive `#C94F3D`) is proposed for a past
  meal that was never confirmed. It is not in `RecipeThemeConfig` yet and must
  be added to the shared contract first.
- Inventory rows use fixed, muted colors per ingredient category. These are the
  one allowed set of palette-independent literals; define them once as a
  constant.
- The shopping list compares the best price per supermarket. This is not in
  the shared PRD yet.
- The stock screen is called "Inventario", following `meal-app-docs/CONTEXT.md`.
