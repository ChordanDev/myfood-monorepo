# Implementation Slices

Vertical implementation order for the meal planning app. Each slice should deliver user-visible value across backend and frontend, with contracts updated in shared docs first.

## Workflow

For each slice:

1. Confirm/update shared docs contract.
2. Create OpenSpec/SDD change when the slice is non-trivial.
3. Implement backend contract with tests.
4. Implement frontend integration and UX states.
5. Verify end-to-end manually and/or with automated tests.
6. Record follow-up tasks before moving on.

## Slice 1 — Auth + Account + Trial Gate

**User story**: As a new user, I want to create an account with an email code so I can enter the app without a password.

### Acceptance criteria

- User can request signup code with email.
- User can verify signup code.
- Backend creates `User`, `Individual Account`, owner `Membership`, 10-day trial, and device session.
- Existing user can login with email code.
- Each device has its own refresh token/session.
- `/me` returns user, account, membership, onboarding status, and `account.access.canUseApp`.
- Expired trial without active subscription returns `canUseApp: false`.
- Front gates app access using `/me`.

### Backend tasks

- Create schemas/tables for users, accounts, memberships, email codes, sessions/trials.
- Implement request/verify signup code.
- Implement request/verify login code.
- Implement refresh/logout.
- Implement `/me` access contract.
- Add rate limits and email-code security rules.
- Add tests for happy paths, expired codes, duplicate signup, missing login email, revoked refresh token.

### Frontend tasks

- Create account screen.
- Login screen.
- Code verification screen.
- Secure token storage.
- Session restore on app launch.
- `/me` loading, error, locked/paywall routing.

### Open questions

- Email delivery provider.
- Billing provider; can be mocked in this slice.

## Slice 2 — Onboarding + Preferences

**User story**: As a user, I want to set my profile, restrictions, and preferences so future meal plans respect what I can and want to eat.

### Acceptance criteria

- After first login, user sees onboarding if not complete.
- User can save display name, hard restrictions, soft preferences, cooking skill, and household size.
- User can view, update, and delete preferences after onboarding.
- Hard restrictions and soft preferences are stored separately.
- `/me` reflects onboarding completion.

### Backend tasks

- Add onboarding profile fields.
- Add preference/restriction schema.
- Implement `PATCH /me/onboarding-profile`.
- Implement `GET /me/preferences`, `PATCH /me/preferences`, `DELETE /me/preferences/:id`.
- Validate preference `kind` and category.
- Add tests for onboarding completion and preference CRUD.

### Frontend tasks

- Build onboarding flow.
- Preference/restriction editor.
- Profile settings entry point.
- Handle validation errors.

## Slice 3 — Recipe Catalog Seed + Favorite MVP

**User story**: As a user, I want to save recipes as favorites so I can reuse them in planning.

### Acceptance criteria

- Backend has seed `MasterRecipe` records sufficient for development.
- User can favorite/unfavorite a master recipe with optimistic UI.
- User can list lightweight favorites locally.
- User can fetch full favorite detail on demand.
- Duplicate favorite by exact recipe reference returns existing favorite.

### Backend tasks

- Create `MasterRecipe`, `FavoriteRecipe`, and minimal ingredient structures.
- Seed sample master recipes with categories and basic assets/placeholders.
- Implement `GET /me/favorites`.
- Implement `GET /me/favorites/:favoriteId`.
- Implement `POST /me/favorites` for `master_recipe`.
- Implement `DELETE /me/favorites/:favoriteId`.
- Add exact-reference dedupe.

### Frontend tasks

- Favorite toggle component with optimistic UI.
- Favorites local cache/sync.
- Favorites picker surface for planner preparation.
- Error rollback UX.

## Slice 4 — Planner Draft Basic

**User story**: As a user, I want to generate a draft meal plan from my preferences and constraints so I can review it before confirming.

### Acceptance criteria

- User can create a draft for N days.
- Backend uses existing `MasterRecipe` candidates only.
- Strict filters apply hard restrictions, diet, budget, and available inventory if present.
- Phoenix Channel emits planner progress/messages and `planning.draft_ready`.
- Draft is persisted and recoverable.
- One active draft per user/account.
- Draft expires after 24h if not confirmed.
- Front renders assistant text plus structured plan cards.

### Backend tasks

- Create draft plan schemas/states.
- Implement `POST /planner/drafts`.
- Implement `GET /planner/drafts/:id`.
- Implement planner channel and event contract.
- Implement basic recipe selection algorithm.
- Emit `assistantMessage` and `structuredPayload`.
- Add tests for draft lifecycle and filtering.

### Frontend tasks

- Planner entry form: days, diet, budget, preferences, favorites.
- Channel subscription and reconnect behavior.
- Chat-like assistant messages.
- Draft cards.
- Resume draft after app restart.

## Slice 5 — Planner Refinement → CustomRecipe

**User story**: As a user, I want to ask the AI to change a meal in my draft and see the modified recipe as a card.

### Acceptance criteria

- User can send a refinement message for a draft.
- Backend emits `planning.refinement_started` and `planning.refinement_ready`.
- Refinement can replace a draft meal with validated `CustomRecipe`.
- Custom recipe ingredients are structured and normalized/categorized as much as possible.
- Structured payload remains source of truth over assistant text.

### Backend tasks

- Implement `POST /planner/drafts/:id/messages`.
- Integrate AI provider or mock adapter for structured custom recipe generation.
- Validate custom recipe schema.
- Validate restrictions and category enum.
- Store custom recipe inside draft.
- Add tests for valid/invalid refinement payloads.

### Frontend tasks

- Draft chat input.
- Per-meal refinement actions/context.
- Replace card on refinement result.
- Error state if refinement fails validation.

### Open questions

- AI provider/model.
- Prompt/schema validation strategy.

## Slice 6 — Confirm Plan + Local Recipe Sync

**User story**: As a user, I want to confirm a draft so my active meal plan and recipes are available in the app.

### Acceptance criteria

- First confirmation creates the account's active confirmed plan.
- Later confirmations extend/modify the same active plan, not create parallel confirmed plans.
- Custom recipes in confirmed plan are saved as `PlanRecipeSnapshot`.
- Front receives/syncs full recipe content for confirmed plan.
- Heavy image/theme assets remain lazy-loaded, with recommended today/tomorrow pre-cache.

### Backend tasks

- Create active meal plan schema.
- Create plan recipe snapshot schema.
- Implement `POST /planner/drafts/:id/confirm`.
- Enforce one active confirmed plan per account.
- Implement plan fetch endpoints as needed.
- Add tests for snapshot immutability and single active plan.

### Frontend tasks

- Confirm draft flow.
- Active plan/calendar state.
- Local recipe content storage/sync.
- Lazy asset loading placeholders.

## Slice 7 — UserRecipe Promotion + Custom Favorites

**User story**: As a user, I want to favorite a custom recipe from my plan so I can reuse it later.

### Acceptance criteria

- Favoriting a plan recipe snapshot creates `UserRecipe` then `FavoriteRecipe`.
- `UserRecipe` is reusable and personal to the user.
- `UserRecipe` inherits assets from base `MasterRecipe` if present.
- Unfavoriting archives `UserRecipe` when needed and preserves plan history.
- User can edit a `UserRecipe` in place.

### Backend tasks

- Create `UserRecipe` schema.
- Extend `POST /me/favorites` for `plan_recipe_snapshot` and `user_recipe`.
- Implement `PATCH /me/user-recipes/:userRecipeId`.
- Implement archive semantics.
- Add tests for promotion, archive, and history preservation.

### Frontend tasks

- Favorite custom recipe from plan/recipe detail.
- Edit user recipe screen or action.
- Reconcile optimistic state after promotion.

## Slice 8 — Shopping List

**User story**: As a user, I want a categorized shopping list generated from my active plan so I know what to buy.

### Acceptance criteria

- Confirmed/edited plan recalculates active shopping list.
- One active shopping list per account.
- Items support `needed`, `purchased`, `removed`, `no_longer_needed`.
- Items support `planned_meal` and `manual` sources.
- Planned ingredients aggregate unless filtered to concrete day.
- Manual items always stay separate.
- User can filter by `untilDate`.
- User can mark individual item purchased.
- User can confirm all visible needed items.
- Purchased item updates inventory immediately and stays visible/tachado until recipe cooked.
- Optional `purchasedQuantity` supports buying less/more.

### Backend tasks

- Create shopping list/item/allocation schemas.
- Implement list generation from active plan snapshots.
- Implement `GET /shopping-list?untilDate=YYYY-MM-DD`.
- Implement `PATCH /shopping-list/items/:itemId`.
- Implement `POST /shopping-list/confirm-visible`.
- Implement aggregation/allocation behavior.
- Add tests for partial purchase, meal swap, day filter, manual items.

### Frontend tasks

- Shopping list UI grouped by category.
- Date range/day filter.
- Purchased/tachado display.
- Quantity override UI.
- Manual item UI.

## Slice 9 — Inventory Movements + Cooking Consumption

**User story**: As a user, I want my inventory to update when I buy ingredients or cook recipes so planning stays accurate.

### Acceptance criteria

- Inventory shows current state.
- Every mutation records `InventoryMovement`.
- Purchased shopping items create purchase movements.
- Marking recipe cooked consumes inventory and clears associated shopping items.
- Inventory cannot go negative; backend clamps to zero and records discrepancy.
- Quantities preserve original input and optional normalized quantity/confidence.

### Backend tasks

- Create inventory item/current state schema.
- Create inventory movement ledger.
- Implement purchase-to-inventory integration.
- Implement cook recipe consumption.
- Implement clamp/discrepancy behavior.
- Implement `GET /inventory`.
- Add tests for movement ledger and reversal edge cases.

### Frontend tasks

- Inventory screen.
- Mark recipe cooked action.
- Show inventory discrepancy warnings if returned.
- Verify shopping list items disappear after cooking.

## Slice 10 — Manual Inventory + Leftovers

**User story**: As a user, I want to manually correct inventory and record leftovers so the app reflects my real kitchen.

### Acceptance criteria

- User can manually add, edit, remove inventory items.
- Delete removes from visible inventory but preserves history.
- After cooking, app asks lightweight leftover prompt.
- Ingredient leftovers update inventory.
- Prepared leftovers are stored separately.

### Backend tasks

- Implement `POST /inventory/items`.
- Implement `PATCH /inventory/items/:id`.
- Implement `DELETE /inventory/items/:id`.
- Create `PreparedLeftover` schema.
- Implement leftover creation endpoints or integrate with cooked flow.
- Add tests for manual movements and leftovers.

### Frontend tasks

- Manual inventory add/edit/remove UX.
- Leftover prompt after cooking: No / comida preparada / ingredientes.
- Prepared leftovers display if in scope.

## Slice 11 — Voice Inventory Adjustment

**User story**: As a user, I want to update inventory by voice so corrections are fast while cooking or eating.

### Acceptance criteria

- Front sends transcript to backend.
- Backend parses structured intent with AI/parser.
- Backend validates action, ingredient, quantity.
- High confidence applies `voice_adjust` movement.
- Low confidence asks frontend for confirmation.
- Voice never mutates inventory on low confidence.

### Backend tasks

- Implement `POST /inventory/voice-adjustments`.
- Add parser/AI adapter with structured output.
- Add confidence thresholds.
- Add confirmation flow if needed.
- Add tests with deterministic parser fixtures.

### Frontend tasks

- Voice input entry point.
- Confirmation UI for low confidence.
- Success/error feedback.

## Post-MVP Slices

- Family Account and Family Plus.
- Account memberships and roles.
- Family planning participants and combined preferences.
- Realtime collaborative shopping list/inventory via Phoenix Channels.
- Per-person meal variants.
- Custom recipe image/theme generation.
- Advanced similarity dedupe for custom recipes.
- Billing provider hardening and subscription management UI.
