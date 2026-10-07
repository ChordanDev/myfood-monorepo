# PRD: AI Planner (Planificador Inteligente)

## 1. Visión

Un asistente conversacional diseñado para crear planes de comidas personalizados (1-10 días) que respeten las preferencias, el presupuesto y optimicen el uso del inventario actual, minimizando el desperdicio.

## 2. Flujo de Usuario

1. **Inicio**: El usuario presiona "+" en la HomeScreen.
2. **Entrada Híbrida**:
   - Pantalla inicial con selectores rápidos para "Días a planificar" (1-10).
   - Selector de **Presupuesto**: Opción de elegir un "Nivel de Gasto" (ej: Muy Barato) o ingresar un "Presupuesto Total" numérico.
   - Botón "Generar Plan" o un campo de texto para peticiones específicas ("Quiero mucha pasta esta semana").
3. **Propuesta**: La IA presenta un **Borrador de Plan** en una interfaz estilo chat.
4. **Refinamiento**: El usuario interactúa mediante lenguaje natural para cambiar comidas o días enteros. Cuando el usuario pide modificar una receta del borrador, la IA genera una **Custom Recipe** derivada de la receta original.
5. **Confirmación**: Al aceptar el borrador, este se convierte en el **Plan de Comidas Local** activo.

## 3. Funcionalidades Detalladas

### 3.1. Pipeline de Planificación MVP

1. El usuario elige cantidad de días, dieta, presupuesto, preferencias subjetivas, alergias/restricciones y favoritos preseleccionados opcionales (`preselectedFavorites: [favoriteId]`).
2. El backend construye un **Planning Context** con preferencias del usuario, inventario disponible, favoritos seleccionados y rango de fechas.
3. La base de datos relacional filtra recetas candidatas con reglas estrictas: presupuesto, dieta, alergias/restricciones, ingredientes disponibles y objetivos nutricionales cuando apliquen.
4. La búsqueda vectorial y/o IA ordena o complementa candidatas según preferencias subjetivas: comidas livianas, sabor casero, facilidad, variedad y baja repetición.
5. El algoritmo del backend arma el **Borrador de Plan** asignando recetas a días/slots con **MasterRecipe** existentes.
6. Durante el refinamiento, si el usuario pide cambiar una receta concreta, la IA genera una **Custom Recipe** derivada de la original y el backend la valida contra restricciones, presupuesto, ingredientes normalizados y formato estructurado.
7. El **Draft Meal Plan** se persiste en DB como estado temporal recuperable.
8. Al confirmar el plan, el backend genera la **Lista de Compras** correspondiente.

### 3.2. Estado del Draft Plan

Estados posibles del borrador:

- `generating`
- `ready`
- `refining`
- `failed`
- `confirmed`
- `discarded`
- `expired`

Reglas MVP:

- El usuario puede cerrar la app y recuperar el borrador por HTTP con `GET /planner/drafts/:id`.
- En MVP hay un solo borrador activo por usuario/cuenta.
- Los borradores no confirmados expiran 24 horas después de su creación.
- Al confirmar por primera vez, se crea el **Confirmed Meal Plan** activo de la Cuenta.
- Si ya existe un plan confirmado, nuevas confirmaciones extienden o modifican ese mismo plan activo; no se crean múltiples planes confirmados coexistentes.
- Un borrador confirmado no se edita más.

### 3.3. Motor de Planificación

- **Filtro Estricto**: Exclusión absoluta basada en **Restricciones** del usuario (ej: sin gluten).
- **Alineación de Presupuesto**: Cálculo del **Costo Estimado de Receta** sumando los precios de los ingredientes y comparándolo con el **Presupuesto** del usuario.
- **Optimización de Inventario**: Escaneo de **Sobras** (ingredientes y comidas) para incluirlas obligatoriamente en los primeros días del plan. Se aplica la regla de **Costo Cero de Inventario**, priorizando el uso de ingredientes existentes sin afectar el límite de presupuesto.

### 3.4. Interfaz del Chat de Planificación

- **Renderizado de Plan**: Capacidad del chat para mostrar "tarjetas" del plan semanal integradas en la conversación, no solo texto.
- **Inyección de Favoritas**: El usuario puede solicitar explícitamente incluir una **Receta Favorita** ("Ponme mi receta de tacos para el viernes").
- **Refinamiento con Custom Recipe**: Si el usuario pide modificar una receta del borrador (ej: "hacela sin queso", "más liviana", "cambiá esta cena por algo con pollo"), la IA devuelve una receta personalizada estructurada. Esa receta reemplaza la opción original dentro del borrador.
- **Snapshot de Receta en Plan**: Si una Custom Recipe queda dentro de un plan confirmado, se guarda completa como snapshot del plan para poder cocinarla, calcular lista de compras y descontar inventario. No se vuelve reutilizable ni aparece en favoritos/búsqueda salvo que el usuario la marque como favorita.

## 4. Salidas (Outputs)

### 4.1. Gateways del Planner

El planner usa HTTP para comandos y Phoenix Channels/WebSocket para progreso y resultados.

Gateways HTTP MVP:

- `POST /planner/drafts`: inicia la generación de un borrador de plan.
- `POST /planner/drafts/:id/messages`: envía un mensaje de refinamiento para cambiar una comida o parte del borrador.
- `POST /planner/drafts/:id/confirm`: confirma el borrador y dispara la generación de lista de compras.
- `GET /planner/drafts/:id`: recupera el estado actual de un borrador si el socket se corta o la app se reabre.

Eventos Phoenix Channel/WebSocket MVP:

- `planning.started`: el backend aceptó la solicitud.
- `planning.message`: texto conversacional parcial o completo para mostrar en el chat.
- `planning.draft_ready`: borrador estructurado listo para renderizar cards.
- `planning.refinement_started`: comenzó una modificación solicitada por el usuario.
- `planning.refinement_ready`: modificación validada lista para reemplazar una comida del borrador.
- `planning.failed`: error recuperable o definitivo.

Regla: HTTP inicia o confirma acciones; Channel informa progreso y resultados. Si se corta el socket, el front recupera estado por HTTP.

### 4.2. Contrato de Respuesta Conversacional + Estructurada

El planner debe entregar una experiencia conversacional tipo chat, pero la UI y la persistencia no deben depender del texto libre de la IA.

Cada respuesta relevante del planner puede incluir:

- `assistantMessage`: texto visible para el usuario, escrito como respuesta conversacional de la IA.
- `structuredPayload`: datos validados por el backend para renderizar cards, confirmar acciones y persistir estado.

Regla de fuente de verdad:

- `assistantMessage` es solo UX conversacional.
- `structuredPayload` es la fuente de verdad para UI, persistencia, lista de compras e inventario.
- Si hay conflicto entre el texto y el payload estructurado, gana `structuredPayload`.

Ejemplo de `planning.draft_ready`:

```json
{
  "event": "planning.draft_ready",
  "draftPlanId": "dp_123",
  "assistantMessage": "Te armé un plan liviano y económico para 3 días, usando arroz y verduras que ya tenés.",
  "structuredPayload": {
    "days": [
      {
        "date": "2026-06-03",
        "meals": [
          {
            "draftMealId": "dm_1",
            "slot": "dinner",
            "title": "Salteado de arroz con verduras",
            "approxDurationMinutes": 25,
            "mainIngredients": ["arroz", "zanahoria", "zucchini"],
            "source": "master_recipe",
            "recipeId": "rec_123"
          }
        ]
      }
    ]
  }
}
```

### 4.3. Efectos al Confirmar

- Actualización de la base de datos de calendario con el nuevo plan.
- Congelamiento de snapshots para las **Custom Recipe** incluidas en el plan confirmado.
- Descarga/sincronización local de los datos completos de receta necesarios para leer y cocinar: ingredientes, cantidades, pasos, duración y porciones.
- Carga diferida de assets pesados: imagen completa, theme/configuración visual y recursos asociados.
- Precache recomendado de assets pesados solo para hoy/mañana; el resto se descarga bajo demanda.
- Disparo del cálculo de la **Lista de Compras** (Feature separada).
