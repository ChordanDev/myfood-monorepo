## Review: PRD AI Planner

### Overview

The PRD clearly defines the user flow, the core features, and the expected outcomes of the AI Planner feature. However, several technical details are missing or ambiguous, which would block or slow down an engineer during implementation.

### Missing/Ambiguous Technical Requirements (Blockers)

1. **AI Model & Integration Architecture:**
   - The PRD mentions an "AI", but does not specify the provider (e.g., OpenAI, Anthropic), the model version, or how the prompt will be constructed and sent.
   - It is unclear how the AI's output is parsed into structured data to render the "tarjetas del plan semanal" instead of plain text (e.g., requiring JSON schema enforcement).

2. **Pricing and Budget Data Sources:**
   - **Alineación de Presupuesto** mentions calculating the "Costo Estimado de Receta" by summing ingredient prices. It is completely unspecified where these prices come from (e.g., user input, third-party supermarket APIs, hardcoded estimates).

3. **Data Schemas & State Management:**
   - The document references "Restricciones", "Sobras", and "Base de datos de calendario", but doesn't define how the AI maps its generated meals to local domain entities (recipes, ingredients, dates).
   - It is ambiguous whether the chat session state needs to be persisted if the app is closed mid-planning, or if it resets.

4. **Inventory (Sobras) Context:**
   - How are "sobras" passed to the AI prompt? There is a risk of exceeding the context window or token limits if the user's entire inventory is sent on every request.

### Recommendation

Before implementation begins, define the AI integration details (provider, output format/JSON), define the source of truth for ingredient pricing, and map out the prompt structure for passing inventory and constraints.
