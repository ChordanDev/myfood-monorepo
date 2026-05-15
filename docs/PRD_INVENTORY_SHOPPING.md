# PRD: Inventory & Shopping List (Inventario y Lista de Compras)

## 1. Visión
Cerrar el ciclo entre la planificación y la ejecución mediante la gestión automática de suministros, asegurando que el usuario siempre sepa qué tiene y qué necesita comprar, minimizando el desperdicio.

## 2. Flujo de Datos
1. **Disparador**: Confirmación de un **Borrador de Plan** en el AI Planner.
2. **Cálculo (Background)**:
   - Se analizan todos los ingredientes de las recetas del plan.
   - Se comparan las cantidades necesarias vs. el **Inventario** actual (usando **Ingredientes Aproximados**).
   - Los faltantes se agregan a la **Lista de Compras**.
3. **Acción del Usuario**: El usuario consulta la lista de compras, realiza la compra física y confirma en la app.
4. **Actualización**: Al confirmar la compra, los ítems se mueven de la lista al **Inventario**.

## 3. Funcionalidades Detalladas
### 3.1. Gestión de Lista de Compras
- **Agrupación**: Ingredientes agrupados por categoría (ej: Verduras, Lácteos) para facilitar la compra física.
- **Edición Manual**: El usuario puede añadir o quitar ítems de la lista manualmente.
- **Validación de Compra**: Checkbox por ítem o botón "Confirmar toda la compra".

### 3.2. Gestión de Inventario
- **Vista de Despensa (Pantry Audit)**: Listado de todos los ingredientes actuales con sus cantidades estimadas. Permite una sincronización rápida mediante gestos (ej: swipe para eliminar ítems que ya no están físicamente).
- **Control Multimodal**: Soporte para entrada de voz para eliminar productos (ej: "Borra la leche").
- **Detección de Sobras**: Registro de **Sobras de Ingrediente** y **Sobras de Comida** tras cocinar (desde la Recipe Experience).

## 4. Lógica de Sincronización
- **Consumo Automático**: Al marcar una receta como "Cocinada", se deducen los ingredientes correspondientes del inventario.
- **Priorización**: El AI Planner siempre consultará este inventario antes de proponer nuevas recetas.
