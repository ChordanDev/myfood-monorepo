## Review: PRD Inventory & Shopping List

Overall, the PRD provides a solid conceptual foundation for the data flow between planning, shopping, and inventory management. However, there are several major technical gaps and ambiguities that need clarification before an engineer can implement it without friction.

### - Correct: What is already good

- The core data flow and state transitions are clear: Plan Draft -> Calculate Deltas -> Shopping List -> Inventory -> Auto-Consumption on cooking.
- The feature requirements outline specific, actionable UI patterns (e.g., categorical grouping, manual edits, swipe gestures).

### - Blocker: Critical ambiguities blocking implementation

- **Unit Normalization & Matching:** The PRD mentions comparing required quantities against the inventory using "Ingredientes Aproximados" (approximate ingredients). There is no specification on how disparate units (e.g., "1 pinch of salt" in a recipe vs. "1 box" in inventory) will be mathematically reconciled or mapped in the database.
- **Partial/Adjusted Purchases:** It states that upon confirming a purchase, items move from the list to the inventory. It does not explain how the system handles the user buying _more_ or _less_ than what was on the list, or buying a different brand/package size. If "Confirm all" just moves the exact requested amounts, the inventory will quickly drift from reality.
- **Multimodal Control (Voice):** Voice support is listed ("Borra la leche"), but there is no definition of how this works technically. Which NLP service is used? How is the intent parsed and matched to an existing inventory item?
- **Auto-Consumption & Leftovers:** Deducting ingredients automatically when a recipe is "Cooked" assumes exact usage. There is no specified flow for the user to report deviations (e.g., using half an onion instead of a whole one). Additionally, it's unclear if "Meal Leftovers" (Sobras de Comida) become a new type of entity in the inventory or a standalone list.

### - Note: Follow-up recommendations

- **Schema Definition:** Provide a basic data model or schema for the `Ingredient`, `InventoryItem`, and `ShoppingListItem` to clarify the relationships and standard units.
- **Scope Phasing:** Consider moving the "Multimodal Voice Control" to a V2, as it introduces significant complexity (audio recording, transcribing, intent parsing) compared to the CRUD operations of the rest of the feature.
