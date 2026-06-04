# PRD: Backend MVP

## 1. Scope

The backend will be built with **Elixir + Phoenix**.

MVP is **individual-first**:

- Each `User` has one `Individual Account`.
- `MealPlan`, `ShoppingList`, and `Inventory` belong to `Account` via `accountId`.
- `Preferences`, `Favorites`, and `UserRecipe` belong to `User`.
- `Family Account`, `Family Plus`, family planning, family realtime collaboration, and shared inventory/list sync are post-MVP.

There is no free plan. Every new account starts with a **10-day trial**. If trial expires without active subscription, the account enters **access lock**.

## 2. Authentication and Account

Authentication is passwordless with email code.

### Signup

- User explicitly chooses **Crear cuenta**.
- Initial signup collects only `email`.
- Backend sends 6-digit email code.
- On successful verification, backend creates:
  - `User`
  - `Individual Account`
  - owner `Membership`
  - device session

### Login

- Existing user enters email.
- Backend sends 6-digit code.
- Verification creates a device session.

### Email code rules

- 6 numeric digits.
- Expires in 10 minutes.
- Store only hashed code.
- Max 5 attempts.
- New code invalidates previous code.
- Resend cooldown: 60 seconds.
- Rate limit by email, IP, and device.

Expected error codes:

- `code_expired`
- `code_invalid`
- `too_many_attempts`
- `rate_limited`
- `email_already_exists`
- `email_not_found`

### Session model

- Each device has its own session.
- `accessToken`: short-lived.
- `refreshToken`: long-lived and revocable.
- Logout revokes only current device/session.

### Auth gateways

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

`/me` returns identity, active account, membership role, onboarding status, and access state. It does not return full preferences.

`account.access.canUseApp` is the frontend's main app gate. If false, frontend shows billing/paywall and does not load internal app data.

## 3. Onboarding and Preferences

Onboarding happens after authentication.

Collect:

- display name
- hard restrictions
- soft preferences
- cooking skill
- household size / people cooked for

Preference model should distinguish:

- `hard_restriction`: allergies, medical restrictions, strict diets, cannot-eat rules.
- `soft_preference`: likes, dislikes, goals, favorite cuisines, avoid-if-possible rules.

Hard restrictions block planner candidates. Soft preferences influence ranking/AI.

## 4. Planner

Planner uses HTTP for commands and Phoenix Channels for progress/results.

### Pipeline

1. User chooses days, diet, budget, preferences, restrictions, and optional `preselectedFavorites: [favoriteId]`.
2. Backend builds planning context from user preferences, inventory, selected favorites, and date range.
3. Relational DB filters strict candidates by budget, diet, allergies/restrictions, ingredient availability, and nutrition goals when applicable.
4. Vector search and/or AI helps rank subjective preferences: light meals, homemade taste, easy, varied, not repetitive.
5. Backend algorithm creates a `DraftMealPlan` with `MasterRecipe` candidates.
6. During refinement, AI may create a validated `CustomRecipe` replacement.
7. Confirming first draft creates the account's active `ConfirmedMealPlan`.
8. Later confirmations extend or modify the same active plan. MVP has only one confirmed active plan per account.
9. Confirmation triggers shopping list recalculation.

### Draft lifecycle

States:

- `generating`
- `ready`
- `refining`
- `failed`
- `confirmed`
- `discarded`
- `expired`

Rules:

- One active draft per user/account in MVP.
- Drafts persist in DB and are recoverable.
- Unconfirmed drafts expire after 24h.
- Confirmed drafts are frozen.

### Planner gateways

HTTP:

- `POST /planner/drafts`
- `POST /planner/drafts/:id/messages`
- `POST /planner/drafts/:id/confirm`
- `GET /planner/drafts/:id`

Phoenix Channel events:

- `planning.started`
- `planning.message`
- `planning.draft_ready`
- `planning.refinement_started`
- `planning.refinement_ready`
- `planning.failed`

Responses may include:

- `assistantMessage`: text shown to user in ChatGPT-like UX.
- `structuredPayload`: backend-validated source of truth for cards, persistence, shopping list, and inventory.

If text conflicts with structured payload, structured payload wins.

## 5. Recipes, Favorites, and Custom Recipes

### Core entities

- `MasterRecipe`: canonical app-owned recipe.
- `CustomRecipe`: AI-created structured recipe from a refinement.
- `PlanRecipeSnapshot`: complete recipe copy stored inside confirmed plan.
- `UserRecipe`: reusable custom recipe owned by user.
- `FavoriteRecipe`: user-owned pointer to `MasterRecipe` or `UserRecipe`.

### Rules

- Initial plans use `MasterRecipe` candidates.
- Refinements can create `CustomRecipe` replacements.
- Confirmed custom recipes are saved as `PlanRecipeSnapshot`.
- Favoriting a plan snapshot promotes it to `UserRecipe`, then creates `FavoriteRecipe` pointer.
- Favorites are personal in MVP.
- Planner can use current user's favorites.
- Deleting favorite removes pointer.
- If favorite pointed to `UserRecipe`, archive custom recipe when needed; do not break plan history.
- Deduplicate favorites only by exact `masterRecipeId` or `userRecipeId`.
- `UserRecipe` inherits image/theme from base `MasterRecipe` in MVP; otherwise uses placeholder/default.
- `UserRecipe` can be edited in place; no versioning in MVP. Confirmed plans remain unchanged because they use snapshots.

### Favorite gateways

- `GET /me/favorites`: lightweight summaries for local cache and planner selection.
- `GET /me/favorites/:favoriteId`: full recipe on demand.
- `POST /me/favorites`: payload `{ source, sourceId }`, source is `master_recipe`, `user_recipe`, or `plan_recipe_snapshot`.
- `DELETE /me/favorites/:favoriteId`
- `PATCH /me/user-recipes/:userRecipeId`

Frontend uses optimistic UI for favorite toggles.

## 6. Confirmed Plan Sync

On plan confirmation:

- Create/update active confirmed meal plan.
- Freeze custom recipe snapshots.
- Sync full recipe content locally: ingredients, quantities, steps, duration, portions.
- Lazy-load heavy assets: full image, theme/config.
- Recommended pre-cache for today/tomorrow only.
- Generate/recalculate shopping list.

## 7. Shopping List

MVP has one active shopping list per account, derived from the one active confirmed meal plan.

### Item states

- `needed`
- `purchased`
- `removed`
- `no_longer_needed`

### Item source

- `planned_meal`
- `manual`

Manual items always display separately and never aggregate with planned ingredients.

### Rules

- Purchased items display crossed/grey.
- Purchased planned items remain visible until their associated recipe is cooked or they leave current filter range.
- Ingredients for cooked recipes disappear from active list.
- Plan edits recalculate unpurchased planned items.
- Purchased ingredients are preserved and re-associated when meals move dates.
- Manual items are not deleted by plan recalculation.
- User can filter list by plan range, e.g. buy first 5 days of 10-day plan.
- Without a specific day filter, identical planned ingredients aggregate visually with internal allocations by recipe/day.
- With a concrete day filter, items show individually by that day's recipe/meal.

### Purchase behavior

- Marking item purchased immediately updates inventory.
- User may provide optional `purchasedQuantity`.
- If omitted, backend uses suggested quantity.
- Buying less than suggested covers nearest recipe first and leaves future shortage as needed.
- Unmarking purchased reverses inventory movement if not consumed.

### Gateways

- `GET /shopping-list?untilDate=YYYY-MM-DD`
- `PATCH /shopping-list/items/:itemId`
- `POST /shopping-list/confirm-visible`

## 8. Ingredient Normalization and Categories

Canonical ingredients have categories.

Allowed MVP categories:

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

For custom recipes, AI can suggest:

- `rawName`
- quantity
- unit
- `normalizedCandidate`
- `suggestedCategory`

Backend validates quantity/unit, matches canonical catalog, and only accepts allowed category enum. If no match, ingredient remains pending/un-normalized and uses valid suggested category or `otros`.

## 9. Inventory

Inventory is current state plus movement ledger.

Every modification creates `InventoryMovement`.

Movement types:

- `purchase`
- `consume_recipe`
- `manual_add`
- `manual_remove`
- `manual_adjust`
- `voice_adjust`
- `reversal`

Quantity model:

- preserve original quantity input
- optionally store normalized quantity in `g`, `ml`, or `unit`
- confidence: `exact` or `estimated`

Inventory cannot go negative. If recipe consumption needs more than available, backend clamps to zero and records discrepancy.

### Inventory gateways

- `GET /inventory`
- `POST /inventory/items`
- `PATCH /inventory/items/:id`
- `DELETE /inventory/items/:id`
- `POST /inventory/voice-adjustments`

`DELETE` means remove/archive from current visible inventory, not physical history deletion.

Voice flow:

1. Front sends transcript.
2. AI/parser returns structured intent.
3. Backend validates action, ingredient, and quantity.
4. High confidence applies `voice_adjust`.
5. Low confidence asks frontend for confirmation.

Voice never mutates inventory if ingredient/action/quantity confidence is low.

## 10. Leftovers

- `IngredientLeftover`: raw ingredient leftover tracked inside inventory.
- `PreparedLeftover`: prepared meal portions tracked separately.

`PreparedLeftover` fields should include:

- accountId
- source meal/recipe
- title
- portions
- storedAt
- consumeByDate optional
- notes optional

After marking recipe cooked, app asks a lightweight prompt:

- No
- Sí, comida preparada
- Sí, ingredientes

## 11. Realtime

MVP realtime scope:

- Phoenix Channels only for planner progress/results and conversational AI streaming.

Post-MVP:

- Family account collaboration for shopping list and inventory sync via Phoenix Channels.
