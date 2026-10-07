# Meal Planning App Context

This context defines the product language for a meal-planning app that coordinates AI planning, recipes, shopping, inventory, and shared accounts.

## Language

**User**:
An individual person authenticated in the app.
_Avoid_: Account, profile

**Email Code Authentication**:
A passwordless authentication flow where a **User** signs in or confirms account creation by entering a short-lived code sent to their email.
_Avoid_: Password login, magic link unless the user clicks a link instead of entering a code

**Explicit Account Creation**:
A user-facing onboarding flow where a new **User** intentionally creates an account with only an email before first sign-in, even though authentication remains passwordless.
_Avoid_: Silent registration, implicit signup

**Onboarding Profile**:
The post-authentication setup data collected after account creation, including display name, household size, and cooking skill.
_Avoid_: Signup data, dietary restrictions, dietary preferences

**Account**:
A billing and sharing container that can be individual or family-scoped.
_Avoid_: User, household

**Individual Account**:
An account used by exactly one **User**.
_Avoid_: Solo user

**Family Account**:
A post-MVP account shared by multiple **Users** where planning, shopping, and inventory are coordinated.
_Avoid_: Family plan when referring to the shared data container

**Family Plus Account**:
A post-MVP higher-tier **Family Account** with additional capabilities not yet defined.
_Avoid_: Premium family unless pricing language is intended

**Individual-First MVP**:
The MVP scope where each **User** operates through one **Individual Account**, while the backend still models account ownership for future family support.
_Avoid_: Family MVP, user-only model

**Trial Period**:
A time-limited access state that lets a new **Account** use the product for 10 days before requiring a paid plan.
_Avoid_: Free plan, freemium

**Access Lock**:
The state where an **Account** cannot use the app after its **Trial Period** expires without an active subscription.
_Avoid_: Read-only mode, free mode

**Membership**:
The relationship that grants a **User** access to an **Account**.
_Avoid_: Subscription, role

**User Preferences**:
A **User**'s individual food preferences, dislikes, restrictions, and diet signals.
_Avoid_: Account preferences

**Hard Restriction**:
A non-negotiable food rule for a **User**, such as allergy, medical restriction, strict diet, or ingredient they cannot eat.
_Avoid_: Preference, dislike

**Soft Preference**:
A negotiable food preference for a **User**, such as likes, dislikes, goals, favorites, or ingredients they prefer to avoid.
_Avoid_: Restriction, allergy

**Planning Context**:
The combined preferences, diets, selected favorites, inventory, budget, participants, meal slots, and date range used to generate a meal plan.
_Avoid_: Prompt, chat context

**Planning Participant**:
A **User** whose preferences and restrictions are considered for a specific **Meal Plan**.
_Avoid_: Member when referring to a concrete planning run

**Meal Slot**:
A planned eating occasion on a date, such as breakfast, lunch, dinner, or snack.
_Avoid_: Recipe, day

**Meal Plan**:
A dated set of planned meals generated for an **Account**.
_Avoid_: Calendar, plan local

**Draft Meal Plan**:
A persisted temporary AI-generated meal plan that can be refined before confirmation and expires if not confirmed.
_Avoid_: AI response, temporary calendar

**Active Draft Meal Plan**:
The single current **Draft Meal Plan** a user/account can continue editing in the MVP.
_Avoid_: Multiple open drafts

**Confirmed Meal Plan**:
The single active accepted **Meal Plan** for an **Account**, used to generate shopping and inventory flows and extended or edited over time.
_Avoid_: Final plan, multiple confirmed plans

**Active Meal Plan**:
The one confirmed plan currently owned by an **Account**.
_Avoid_: Plan history when referring to the current editable plan

**Favorite Recipe**:
A user-owned saved pointer to a reusable recipe, either a **Master Recipe** or **User Recipe**.
_Avoid_: Saved meal, recipe copy

**User Recipe**:
A reusable custom recipe owned by a **User**, usually promoted from a **Custom Recipe** or **Plan Recipe Snapshot**.
_Avoid_: Favorite, master recipe

**Inherited Recipe Assets**:
Image and theme assets reused from the **Master Recipe** that a **User Recipe** was derived from.
_Avoid_: Generated custom assets

**Archived User Recipe**:
A **User Recipe** that is no longer reusable or shown in favorites/planning, but remains stored to preserve plan history.
_Avoid_: Deleted recipe

**Master Recipe**:
A canonical recipe owned by the app's recipe bank.
_Avoid_: General recipe, base recipe

**Custom Recipe**:
A structured recipe created by AI from a user-requested modification to a **Master Recipe** or draft meal option.
_Avoid_: Invented recipe, modified recipe

**Recipe Refinement**:
A conversational change request that replaces a draft meal option with a validated **Custom Recipe**.
_Avoid_: Free chat, unstructured edit

**Plan Recipe Snapshot**:
A complete recipe copy stored inside a confirmed meal plan so the user can cook it even if it is not reusable or favorited.
_Avoid_: Favorite recipe, master recipe

**Shopping List**:
The categorized list of ingredients needed for a **Confirmed Meal Plan** after considering inventory.
_Avoid_: Grocery plan

**Inventory**:
The account-owned current state of available ingredients and quantities.
_Avoid_: Pantry, despensa

**Inventory Movement**:
An auditable change to **Inventory**, such as purchase, recipe consumption, manual adjustment, voice adjustment, or reversal.
_Avoid_: Inventory item

**Ingredient Leftover**:
A remaining raw ingredient tracked as part of **Inventory**.
_Avoid_: Prepared leftover

**Prepared Leftover**:
A remaining prepared meal portion stored separately from **Inventory**.
_Avoid_: Ingredient leftover, inventory item

## Relationships

- A new **User** is created through **Explicit Account Creation** with only an email and confirms ownership of that email through **Email Code Authentication**.
- An **Onboarding Profile** is collected after authentication, not during initial account creation.
- In the **Individual-First MVP**, each **User** has one **Individual Account**.
- A **User** can belong to one or more **Accounts** through **Memberships** after family support is introduced.
- An **Account** can be an **Individual Account**, **Family Account**, or **Family Plus Account**.
- A new **Account** starts in a 10-day **Trial Period**; there is no free plan.
- An **Account** enters **Access Lock** when the **Trial Period** expires without an active subscription.
- A **Family Account** has multiple **Users** after family support is introduced.
- A **Meal Plan**, **Shopping List**, and **Inventory** belong to exactly one **Account**.
- Every change to **Inventory** creates an **Inventory Movement**.
- An **Ingredient Leftover** is tracked inside **Inventory**.
- A **Prepared Leftover** is tracked separately from **Inventory** and can reference the meal that produced it.
- In the MVP, an **Account** has at most one **Active Meal Plan**.
- **User Preferences** belong to exactly one **User**.
- A **Planning Context** for a family plan combines the preferences and diets of the selected **Planning Participants**.
- If no **Planning Participants** are selected, all active **Users** in the **Account** are included by default.
- A **Hard Restriction** from any relevant **Planning Participant** applies to the whole family **Meal Plan** in the MVP.
- A **Soft Preference** influences planning but does not block a family **Meal Plan**.
- In the MVP, a **Favorite Recipe** belongs to exactly one **User** and references either a **Master Recipe** or a **User Recipe**.
- A **Recipe Refinement** can create a **Custom Recipe** inside a **Draft Meal Plan**.
- In the MVP, a user/account has at most one **Active Draft Meal Plan** at a time.
- A **Draft Meal Plan** expires 24 hours after creation if not confirmed.
- A **Custom Recipe** in a confirmed **Meal Plan** is stored as a **Plan Recipe Snapshot** unless the user saves it as a **Favorite Recipe**.
- Saving a **Plan Recipe Snapshot** as a favorite promotes it to a **User Recipe** and creates a **Favorite Recipe** pointer.
- Removing a favorite deletes the **Favorite Recipe** pointer; related **User Recipes** are archived instead of physically deleted when history integrity requires it.
- In the MVP, a **User Recipe** uses **Inherited Recipe Assets** from its base **Master Recipe** when available; otherwise it uses default placeholders.
- The planner can use the current **User**'s **Favorite Recipes** as planning input in the MVP.

## Example dialogue

> **Dev:** "When a family creates a **Meal Plan**, do we use only the preferences of the user who pressed generate?"
> **Domain expert:** "No — for a **Family Account**, the **Planning Context** must consider the preferences and diet of every relevant **User** in that account."

## Flagged ambiguities

- "Cuenta" and "usuario" are distinct: **User** is the individual person; **Account** is the individual or shared container.
- "Family plan" can mean subscription tier or shared data container; use **Family Account** for the shared product concept and reserve pricing names for plan tiers.
- Family planning is post-MVP; the MVP is **Individual-First**.
- Family planning starts as one shared **Meal Plan** for the account; per-person meal variants are a future extension, not the MVP default.
- A **User** can belong to an **Account** but be excluded from a specific **Meal Plan** by not being selected as a **Planning Participant** after family support exists.
