# MyFood Glossary

This file and `docs/adr/` are the only durable docs in the repository. Specs, maps and plans live in GitHub issues (wayfinder / to-spec) and are disposable once the work ships. Terms are grouped by bounded context; `(code: ...)` names the module or type that carries the concept, and `(alias: ...)` records words older docs used for it. When docs and code disagreed, the code's name wins and the docs' word is kept as an alias. Avoid aliases in new code, issues and conversation.

## Accounts & access

**User** — An individual person who authenticates with an email address. A User belongs to one or more Accounts through Memberships. `(code: Persistence.Accounts.User)`

**Account** — The container that owns plans, shopping and inventory, and that is billed. Its `plan` is `individual`, `family_4`, `family_6` or `trial`. `(code: Persistence.Accounts.Account)` `(alias: Individual Account, Family Account, Family Plus Account, Cuenta)`

**Membership** — The relationship that grants a User access to an Account, with a role (`owner` or `member`) and a status (`active`, `invited`, `suspended`). `(code: Persistence.Accounts.AccountMembership, AccountsMembership)`

**Invite** — A single-use token that, when consumed, creates a Membership for the invited email in an Account. `(code: Services.InviteService)`

**Seat cap** — The maximum number of active Memberships an Account's plan allows (1 individual, 4 family_4, 6 family_6 and trial). `(code: AccountsMembership)`

**Account selection continuation** — A short-lived single-use token handed to a User who verified an email code but belongs to several Accounts, so they can pick which one to enter. `(code: Persistence.Auth.AccountSelectionContinuation)`

**Email code authentication** — Passwordless sign-in and sign-up: the User receives a short-lived numeric code by email and enters it in the app. `(code: Services.EmailCodeAuth, Persistence.Auth.EmailVerificationCode)` `(alias: magic link, OTP login)`

**Explicit account creation** — Sign-up is a deliberate flow: the User enters only an email, confirms the code, and only then are the User, their Account and a session created. `(alias: silent registration)`

**Device session** — One authenticated device, holding a short-lived access token and a revocable refresh token; logging out one device does not end the others. `(code: Services.DeviceSessions, Persistence.Auth.DeviceSession, mobile authTokenStore)`

**Trial** — The time-limited free access every new Account starts with before it needs an active entitlement. Code grants 7 days; older docs said 10. `(code: AccountAccess)` `(alias: Trial Period, free plan)`

**Access state** — Whether an Account may use the app right now: `trial`, `active` (an entitlement covers now) or `expired`. `(code: AccountAccess)` `(alias: trialing / locked, Access Lock, canUseApp)`

**Entitlement** — A paid access grant synced from the store subscription provider; an active entitlement makes the Account `active`. `(code: Persistence.Accounts.RevenuecatEntitlement)` `(alias: subscription)`

**Subscription plan** — A purchasable tier that maps to an Account plan and its seat cap. `(code: Subscriptions.Plan)` `(alias: Family plan, Premium family)`

## Profile & preferences

**Onboarding profile** — The setup data captured right after first authentication: display name, household size and cooking skill. Dietary data is not part of it. `(code: mobile OnboardingProfile)` `(alias: signup data)`

**Cooking skill** — The User's self-declared level: `beginner`, `intermediate` or `advanced`. `(code: mobile CookingSkill)`

**Household size** — How many people the User usually cooks for. `(code: mobile OnboardingProfile.householdSize)` `(alias: people cooked for)`

**User preferences** — A User's own food signals, stored apart from the User and editable after onboarding: diet, hard restrictions and soft preferences. `(code: Services.UserPreferencesService, mobile UserPreferencesPayload)` `(alias: account preferences)`

**Diet** — The User's dietary pattern: `omnivore`, `vegetarian`, `vegan`, `pescatarian` (API also knows `celiac`); `null` means none chosen. `(code: Persistence.Accounts.UserDietaryProfile, mobile DietCode)`

**Hard restriction** — A non-negotiable food rule such as an allergy or medical restriction; it excludes recipe candidates outright. Stored as a code from a fixed list, distinct from an Excluded ingredient. `(code: Persistence.Accounts.UserHardRestriction, mobile HardRestrictionCode)` `(alias: restriction, allergy list)`

**Soft preference** — A negotiable like, dislike or goal that influences ranking but never blocks a plan. `(code: Persistence.Accounts.UserPreference.soft_preferences, mobile softPreferences)` `(alias: preference, dislike)`

**Excluded ingredient** — One concrete ingredient a User will not eat, tagged as `allergy` (hard) or `dislike` (soft). `(code: Persistence.Accounts.UserExcludedIngredient)`

**Meal slot** — A named eating occasion within a day: `breakfast`, `lunch`, `snack`, `dinner`. The mobile onboarding currently captures only breakfast, lunch and dinner. `(code: Persistence.Planning.ScheduledMeal.slot, mobile MealSlot)` `(alias: meal type, momento)`

**Slot cooking time** — For each Meal slot, how many minutes the User is willing to cook (0 means they do not cook that slot) and their Hunger level. `(code: mobile SlotCookingTime)`

**Hunger level** — How big a meal the User wants in a slot: `light`, `normal` or `strong`. `(code: mobile HungerLevel)`

**Budget** — The weekly spending limit for an Account, resolved from its plan and tier. `(code: Budgets.Budget, Services.BudgetService)` `(alias: spending level, presupuesto total)`

## Catalog

**Ingredient** — A canonical food item with a category, base unit and nutrition per 100 units. `(code: Persistence.Catalog.Ingredient)`

**Ingredient category** — The shopping-aisle grouping of an Ingredient (`verduras`, `lacteos`, `almacen`, ...). `(code: mobile IngredientCategory)`

**Unit** — The normalized measure of a quantity: `g`, `ml` or `unit`. Quantities are stored in thousandths (`quantity_milli`). `(code: mobile UnitType)`

**Unit conversion** — A rule for turning a recipe or purchase quantity into an Ingredient's base unit. `(code: Persistence.Catalog.UnitConversion)`

**Recipe** — A cookable dish with steps, ingredients, servings and nutrition. Its `source` is `traditional` (curated bank), `ai_generated` or `user_created`. `(code: Persistence.Catalog.Recipe)` `(alias: Master Recipe, Receta Maestra, Custom Recipe, User Recipe)`

**Recipe source** — Where a Recipe came from; `traditional` recipes are the trusted bank the planner draws from, the other two are derived. `(code: Recipe.source)`

**Recipe version** — An immutable published snapshot of a Recipe; a successor version gets a new Recipe row so existing proposals keep their recipe identity. `(code: Persistence.Catalog.RecipeVersion, Services.RecipeVersions)`

**Recipe snapshot** — The full copy of a recipe frozen inside a Scheduled meal so it can be cooked and shopped even if the catalog changes later. `(code: ScheduledMeal.recipe_snapshot)` `(alias: Plan Recipe Snapshot)`

**Favorite recipe** — A User's reusable pointer to a Recipe, used as planning input. `(code: Persistence.Catalog.FavoriteRecipe)` `(alias: saved meal)`

**Slot favorite** — A favorite at the instance level: this date's lunch with this recipe, not the recipe itself. `(code: Persistence.Catalog.SlotFavorite)`

**Recipe theme** — The color palette attached to a Recipe that the app applies globally while that recipe is today's selected meal. `(code: mobile RecipeThemeConfig, RecipeThemeContext)` `(alias: Rich Aesthetics)`

**Recipe cost** — The estimated price of cooking a Recipe on a given day, summed from Ingredient prices. `(code: Persistence.Catalog.RecipeDailyCost, Persistence.Shopping.RecipePrice)` `(alias: Costo Estimado de Receta)`

## Planning

**Planning context** — Everything the planner reasons over for one run: preferences, restrictions, favorites, inventory, budget, slots and date range. `(code: PlanningGenerationRun.input_context)` `(alias: prompt, chat context)`

**Planning session** — The per-Account, per-date-range conversation in which a plan is generated and refined. Holds a range lock and moves one-way out of `active` to `committed`, `cancelled`, `expired` or `lost_lock`. `(code: Persistence.Planning.PlanningSession, Generation.PlanningSessionServer)` `(alias: planner chat)`

**Range lock** — The guarantee that only one Planning session can be active for an Account over overlapping dates, owned by a lock-owner Membership and renewed by a lease. `(code: PlanningSession.lease_expires_at)`

**Generation run** — One execution of the planning pipeline inside a session, producing proposals and, once accepted, Scheduled meals. `(code: Persistence.Planning.PlanningGenerationRun, Generation.Server)`

**Planning candidate** — A Recipe eligible to enter the optimizer after server-side filtering by account scope, restrictions and slot suitability. `(code: Services.PlanningCandidateBuilder)`

**Optimizer** — The external solver that assigns candidates to slots under budget and variety constraints, with a fallback when it is unavailable. `(code: Optimization.OptimizerPort, Optimization.OptimizerFallback)`

**Planning proposal** — A generated plan awaiting the User's decision: `pending`, `accepted` or `rejected`. `(code: Persistence.Planning.PlanningProposal)` `(alias: Draft Meal Plan, Borrador de Plan)`

**Planning message** — One conversational turn in a Planning session, including refinement requests such as "swap Monday's dinner". `(code: Persistence.Planning.PlanningMessage)` `(alias: Recipe Refinement)`

**Planning exception** — A logged anomaly scoped to a session: forbidden intent, validation error, optimizer failure. `(code: Persistence.Planning.PlanningException)`

**Scheduled meal** — An accepted meal on a date and slot, carrying its Recipe snapshot and whether it was cooked. The set of Scheduled meals is the Account's live plan. `(code: Persistence.Planning.ScheduledMeal, mobile MealPlanEntry)` `(alias: Confirmed Meal Plan, Active Meal Plan, Plan de Comidas Local)`

**Skipped meal** — A Scheduled meal whose date passed without being cooked; never cooked and skipped at once. `(code: mobile MealPlanEntry.isSkipped)`

**Rescue plan** — A single recipe suggested on demand from ingredients the User wants to use up before they spoil. `(code: Services.InventoryService.rescue_plan)`

## Cooking

**Cooking session** — The runtime of cooking one Scheduled meal: `active`, `paused` or `completed`, with its step events and chat. `(code: Persistence.Planning.CookingSession, Services.CookingService)`

**Cooking step event** — A recorded progression through a recipe step during a Cooking session. `(code: Persistence.Planning.CookingStepEvent)`

**Cooking chat** — The recipe-scoped AI assistant available while cooking today's meal; it knows the recipe and current inventory. `(code: Persistence.Planning.CookingChatMessage)` `(alias: Chat Contextual de Receta, Contexto Inyectado)`

**Context snapshot** — The frozen recipe-and-inventory state the Cooking chat answers from. `(code: Persistence.Planning.ContextSnapshot)`

**Cooked meal** — A Scheduled meal marked as cooked, which consumes its ingredients from Inventory and removes its items from the shopping list. `(code: ScheduledMeal.is_cooked, InventoryMutationEvent trigger=cooking)` `(alias: Consumo Automático)`

**Ingredient leftover** — A remaining raw ingredient after cooking, kept in Inventory as a normal item flagged as leftover. `(code: mobile InventoryItem.isLeftover)` `(alias: Sobras de Ingrediente)`

**Prepared leftover** — A remaining cooked portion stored apart from Inventory with its source meal and a consume-by date. Docs only; not yet modeled in code. `(alias: Sobras de Comida, PreparedLeftover)`

**Voice adjustment** — An inventory change parsed from a spoken sentence; applied only when the parser is confident, otherwise previewed for confirmation. `(code: Voice.VoiceParserPort, InventoryMutationEvent trigger=voice)`

## Shopping & inventory

**Shopping list** — The Account's current set of Shopping items derived from upcoming Scheduled meals minus Inventory, plus manual additions. `(code: Services.ShoppingService, ShoppingCheckout)` `(alias: Lista de Compras, grocery plan)`

**Shopping item** — One ingredient quantity to buy for a planned date, optionally assigned to a Supermarket, with a status of `needed`, `in_cart` or `removed`. `(code: Persistence.Shopping.ShoppingItem, mobile ShoppingItemStatus)` `(alias: purchased, no_longer_needed)`

**Shopping item source** — Whether a Shopping item came from a `planned_meal` or was added `manual`ly; manual items never merge with planned ones. `(code: mobile ShoppingItemSource)`

**Shortage** — The net quantity of an ingredient still missing after subtracting available Inventory from what Scheduled meals need. `(code: Services.ShoppingRebuilder)` `(alias: faltante)`

**Cart** — The Shopping items a User has marked for purchase but not yet confirmed. `(code: Cart)` `(alias: in_cart)`

**Cart lease** — The one-hour exclusive hold a User has on a Cart; abandoned leases are released automatically. `(code: Cart, CartSweeper, CheckoutSession.lease_expires_at)`

**Checkout session** — The atomic act of confirming a Cart as purchased (`physical` or `online`), which moves its items into Inventory. `(code: Persistence.Shopping.CheckoutSession, ShoppingCheckout)` `(alias: confirmar compra)`

**Supermarket** — A store, with a catalog and optional scraped prices, that Shopping items can be assigned to. `(code: Persistence.Shopping.Supermarket, Persistence.Shopping.SupermarketCatalog)`

**Ingredient price** — A dated price for an Ingredient at a Supermarket, feeding Recipe cost and Budget checks. `(code: Persistence.Shopping.IngredientPrice, Services.PriceService)`

**Inventory** — The Account's current stock of ingredients and quantities, the planner's first source before proposing anything. `(code: Persistence.Inventory, Inventory)` `(alias: pantry, despensa)`

**Inventory item** — One lot of an Ingredient in Inventory: quantity, unit, acquisition date and price, and whether it was `planned` (bought for a meal) or `extra`. `(code: Persistence.Inventory.InventoryItem)` `(alias: inventory lot, stock item)`

**Lot freshness** — The rule that decides when an Inventory item expires (explicit date, else inferred from category and acquisition) and which lot is consumed first (FEFO). `(code: Inventory.LotFreshness)`

**Inventory mutation event** — The auditable record of every Inventory change: trigger (`purchase`, `cooking`, `manual`, `voice`), operation (`add`, `subtract`, `set`, `delete`) and before/after quantities. `(code: Persistence.Inventory.InventoryMutationEvent)` `(alias: Inventory Movement, InventoryMovement)`
