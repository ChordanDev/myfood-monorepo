# Backend Handoff

Use this document to bootstrap the future Elixir + Phoenix backend repo. It summarizes the current product/backend decisions refined from the frontend PRDs.

## Source docs in frontend repo

- `CONTEXT.md` — canonical product language/glossary.
- `docs/PRD_BACKEND.md` — consolidated backend PRD.
- `docs/PRD_APP.md` — app-wide product decisions.
- `docs/PRD_AI_PLANNER.md` — planner flow, draft lifecycle, HTTP/Channel split.
- `docs/PRD_RECIPE_EXPERIENCE.md` — recipe, favorites, custom recipe, local sync.
- `docs/PRD_INVENTORY_SHOPPING.md` — shopping list, inventory, leftovers.

## Key decisions

### MVP scope

- Backend stack: **Elixir + Phoenix**.
- MVP is **individual-first**.
- Still model `Account` from day 1 to support future family accounts.
- One `User` has one `Individual Account` in MVP.
- `MealPlan`, `ShoppingList`, `Inventory` belong to `Account`.
- `Preferences`, `FavoriteRecipe`, `UserRecipe` belong to `User`.
- Family account, family plus, family planning, and family realtime collaboration are **post-MVP**.

### Access model

- No free plan.
- New account gets 10-day trial.
- Trial expiration without active subscription locks app access.
- User can authenticate to solve billing, but cannot access app data/features while locked.
- `/me` must expose `account.access.canUseApp` as frontend gate.

### Auth

- Passwordless email code, not password.
- Explicit signup flow, not silent auto-registration.
- Signup collects only email; onboarding profile is after auth.
- Device-scoped sessions with access token + refresh token.

Auth gateways:

- `POST /auth/signup/request-code`
- `POST /auth/signup/verify-code`
- `POST /auth/login/request-code`
- `POST /auth/login/verify-code`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `PATCH /me/onboarding-profile`
- `GET /me/preferences`
- `PATCH /me/preferences`
- `DELETE /me/preferences/:id`

### Planner

- Use HTTP for commands.
- Use Phoenix Channels for progress/results/AI chat-like messages.
- `assistantMessage` is UX text.
- `structuredPayload` is source of truth.
- Initial plan uses `MasterRecipe` candidates.
- Refinements may create validated `CustomRecipe` replacements.
- Drafts persist, one active per account/user, expire in 24h.
- There is only one active confirmed meal plan per account; later planning extends/edits it.

Planner gateways:

- `POST /planner/drafts`
- `POST /planner/drafts/:id/messages`
- `POST /planner/drafts/:id/confirm`
- `GET /planner/drafts/:id`

Channel events:

- `planning.started`
- `planning.message`
- `planning.draft_ready`
- `planning.refinement_started`
- `planning.refinement_ready`
- `planning.failed`

### Recipes/favorites

- `FavoriteRecipe` is a pointer owned by user.
- It points to `MasterRecipe` or `UserRecipe`.
- `UserRecipe` stores reusable custom recipe.
- Confirmed custom recipes are stored as `PlanRecipeSnapshot`.
- Favoriting a plan snapshot promotes it to `UserRecipe` then creates favorite pointer.
- Favorites are personal in MVP.
- Optimistic UI for favorite toggling.
- UserRecipe assets inherit from base MasterRecipe in MVP.
- UserRecipe edits are in-place; no versioning MVP.

Favorite gateways:

- `GET /me/favorites`
- `GET /me/favorites/:favoriteId`
- `POST /me/favorites`
- `DELETE /me/favorites/:favoriteId`
- `PATCH /me/user-recipes/:userRecipeId`

### Confirmed plan sync

On confirmation:

- sync full recipe content locally: ingredients, quantities, steps, duration, portions.
- lazy-load heavy assets: image/theme/config.
- pre-cache today/tomorrow assets recommended.
- generate/recalculate shopping list.

### Shopping list

- One active shopping list per account.
- Derived from single active confirmed meal plan.
- Items have state: `needed`, `purchased`, `removed`, `no_longer_needed`.
- Items have source: `planned_meal` or `manual`.
- Manual items always display separately.
- Purchased items show crossed/grey and remain until associated recipe is cooked.
- Cooking recipe clears associated shopping items.
- Plan edits recalc unpurchased planned items and preserve purchased ones.
- Aggregated view groups same planned ingredients with internal allocations.
- Concrete day filter shows individual ingredients per recipe/day.
- Purchase can include optional real `purchasedQuantity`.
- Marking purchased immediately updates inventory.

Shopping gateways:

- `GET /shopping-list?untilDate=YYYY-MM-DD`
- `PATCH /shopping-list/items/:itemId`
- `POST /shopping-list/confirm-visible`

### Ingredient normalization

- Canonical ingredient catalog owns categories.
- CustomRecipe ingredient normalization can use AI suggestions, but backend validates.
- AI cannot invent categories outside allowed enum.

Allowed categories:

- `verduras`
- `frutas`
- `carnes`
- `pescados_mariscos`
- `lacteos`
- `panaderia`
- `almacen`
- `congelados`
- `bebidas`
- `condimentos`
- `limpieza_otros`
- `otros`

### Inventory

- Inventory is visible current state + movement ledger.
- Every mutation creates `InventoryMovement`.
- Movement types: `purchase`, `consume_recipe`, `manual_add`, `manual_remove`, `manual_adjust`, `voice_adjust`, `reversal`.
- Preserve original quantity and optional normalized quantity in `g`, `ml`, or `unit`.
- Quantity confidence is `exact` or `estimated`.
- Inventory cannot go negative; clamp to zero and record discrepancy.

Inventory gateways:

- `GET /inventory`
- `POST /inventory/items`
- `PATCH /inventory/items/:id`
- `DELETE /inventory/items/:id`
- `POST /inventory/voice-adjustments`

### Voice

Voice adjustment flow:

1. Front sends transcript.
2. AI/parser returns structured intent.
3. Backend validates action/ingredient/quantity.
4. High confidence applies movement.
5. Low confidence asks frontend for confirmation.

Never mutate inventory on low confidence.

### Leftovers

- Raw ingredient leftovers stay in inventory.
- Prepared meal leftovers are separate `PreparedLeftover` records.
- After marking cooked, app asks: No / Sí comida preparada / Sí ingredientes.

## Recommended backend repo first steps

1. Copy `docs/PRD_BACKEND.md` and `CONTEXT.md` into backend repo.
2. Start OpenSpec/SDD for the first backend slice, probably auth/account:
   - passwordless email code
   - user/account/membership creation
   - sessions/refresh tokens
   - `/me` access contract
3. Implement in vertical slices; do not start with all planner/inventory complexity.

## Suggested first SDD change

`implement-auth-account-mvp`

Acceptance scope:

- explicit signup with email code
- login with email code
- per-device session and refresh token
- individual account auto-created on signup verify
- 10-day trial created on account
- `/me` returns user/account/membership/onboarding/access
- access lock semantics represented, even if billing integration is mocked

## Open questions

- Billing provider and subscription implementation details.
- AI provider/model for planner and ingredient parsing.
- Recipe catalog seed/source.
- Pricing data source for budget filtering.
- Exact nutrition fields required for filtering.
- Deployment target for Phoenix backend.
