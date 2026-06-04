# PRD: Inventory & Shopping List (Inventario y Lista de Compras)

## 1. Visión

Cerrar el ciclo entre la planificación y la ejecución mediante la gestión automática de suministros, asegurando que el usuario siempre sepa qué tiene y qué necesita comprar, minimizando el desperdicio.

## 2. Flujo de Datos

1. **Disparador**: Confirmación inicial, extensión o edición del único **Plan Confirmado** activo en el AI Planner.
2. **Cálculo (Background)**:
   - Se analizan todos los ingredientes de las recetas del plan.
   - Se comparan las cantidades necesarias vs. el **Inventario** actual (usando **Ingredientes Aproximados**).
   - Los faltantes se agregan o recalculan en la **Lista de Compras** activa.
3. **Acción del Usuario**: El usuario consulta la lista de compras, realiza la compra física y confirma en la app.
4. **Actualización**: Cada ítem entra al **Inventario** inmediatamente al marcarse como comprado. Queda visible como comprado/tachado y recién desaparece de la lista cuando las recetas asociadas ya fueron cocinadas o deja de pertenecer al rango visible.

## 3. Funcionalidades Detalladas

### 3.1. Gestión de Lista de Compras

- **Lista Activa Única**: En MVP existe una sola lista de compras activa por Cuenta, derivada del único Plan Confirmado activo.
- **Plan Extensible**: El usuario no crea múltiples planes confirmados; el plan activo se agranda, se ajusta o intercambia comidas dentro del mismo plan.
- **Agrupación**: Ingredientes agrupados por categoría (ej: Verduras, Lácteos) para facilitar la compra física. Sin filtro por día específico, ingredientes iguales se muestran agregados visualmente con trazabilidad interna por receta/día. La categoría proviene del catálogo canónico de ingredientes cuando existe.
- **Agrupación vs. Filtro Diario**: Si el usuario filtra por un día concreto, la lista muestra los ingredientes de ese día de manera individual por receta/comida, no agregados con otros días.
- **Filtro por Rango del Plan**: El usuario puede filtrar la lista por días del plan para comprar solo hasta una fecha determinada (ej: primeros 5 días de un plan de 10 días). El filtro afecta la visualización y selección de compra, no elimina ítems del plan.
- **Edición Manual**: El usuario puede añadir o quitar ítems de la lista manualmente.
- **Validación de Compra**: Checkbox por ítem individual o acción masiva sobre los ítems visibles del filtro actual. Al marcar comprado, el usuario puede aceptar la cantidad sugerida o registrar una cantidad comprada menor/mayor.
- **Estados de Ítem**: Cada ítem puede estar `needed`, `purchased`, `removed` o `no_longer_needed`. Los ítems `purchased` se muestran tachados/en gris, no se eliminan inmediatamente.
- **Sources de Ítem**: Cada ítem indica si viene de una receta planificada (`planned_meal`) o fue agregado manualmente (`manual`). Los ítems manuales siempre se muestran separados como agregados manualmente y no se agrupan con ingredientes planificados aunque representen el mismo ingrediente.
- **Recalculo por Edición del Plan**: Al intercambiar o mover comidas dentro del plan activo, los ingredientes comprados se preservan y se reasocian a la nueva fecha/receta cuando siguen siendo necesarios. Los ítems planificados no comprados se recalculan. Los ítems manuales no se eliminan por cambios del plan.
- **Desaparición de Ítems**: Los ingredientes asociados a recetas ya cocinadas desaparecen de la lista activa. Si el ingrediente ya fue comprado pero la receta todavía no fue cocinada, sigue apareciendo como comprado/tachado.
- **Gateways MVP de Lista**:
  - `GET /shopping-list?untilDate=YYYY-MM-DD`: devuelve la lista activa filtrada opcionalmente hasta una fecha del plan.
  - `PATCH /shopping-list/items/:itemId`: marca o desmarca un ítem individual como comprado. Acepta `purchasedQuantity` opcional para indicar cantidad real comprada.
  - `POST /shopping-list/confirm-visible`: marca como comprados todos los ítems `needed` visibles según el filtro/rango enviado.
- **Efecto de Compra**: Al marcar un ítem como comprado, se muestra tachado/en gris y se registra o actualiza en inventario inmediatamente, pero no desaparece hasta que se cocina la receta asociada o deja de pertenecer al rango visible. Si se desmarca como comprado, el backend revierte el movimiento de inventario cuando todavía no fue consumido.
- **Cantidad Comprada Real**: Si el usuario no indica cantidad comprada, el backend usa la cantidad sugerida. Si compra menos o más, la diferencia impacta en inventario. Ejemplo: si la lista sugiere 2 paquetes de fideos para lunes y jueves, el usuario puede comprar solo 1 paquete; ese paquete cubre la receta más próxima y el faltante restante sigue apareciendo como necesario para la receta futura.
- **Allocations Internas**: Cuando la vista está agregada, cada ítem mantiene allocations internas por receta/día para saber qué cantidad corresponde a cada comida. Esto permite reasignar compras parciales y limpiar ítems cuando una receta se cocina.
- **Normalización de Ingredientes Custom**: Para recetas custom, la IA puede devolver ingredientes con `rawName`, cantidad, unidad, `normalizedCandidate` y `suggestedCategory`. El backend valida cantidad/unidad, intenta matchear contra el catálogo canónico y solo acepta categorías dentro del enum permitido. Si no hay match, el ingrediente queda pendiente/no normalizado y usa `suggestedCategory` válida o `otros` como fallback.
- **Categorías Permitidas MVP**: `verduras`, `frutas`, `carnes`, `pescados_mariscos`, `lacteos`, `panaderia`, `almacen`, `congelados`, `bebidas`, `condimentos`, `limpieza_otros`, `otros`.

### 3.2. Gestión de Inventario

- **Modelo de Inventario**: El inventario visible es el estado actual por ingrediente/cantidad, pero toda modificación genera un `InventoryMovement` auditable.
- **Cantidades**: Cada ítem conserva la cantidad original ingresada y, cuando sea posible, una cantidad normalizada a `g`, `ml` o `unit`.
- **Confianza de Cantidad**: Cada cantidad se marca como `exact` o `estimated`. Si el backend no puede normalizar con certeza, conserva la entrada original y muestra el dato como aproximado.
- **Tipos de Movimiento MVP**: `purchase`, `consume_recipe`, `manual_add`, `manual_remove`, `manual_adjust`, `voice_adjust`, `reversal`.
- **Vista de Despensa (Pantry Audit)**: Listado de todos los ingredientes actuales con sus cantidades estimadas. Permite una sincronización rápida mediante gestos (ej: swipe para eliminar ítems que ya no están físicamente).
- **Gateways MVP de Inventario**:
  - `GET /inventory`: devuelve el estado actual visible del inventario.
  - `POST /inventory/items`: agrega un ingrediente manualmente y crea movimiento `manual_add`.
  - `PATCH /inventory/items/:id`: ajusta cantidad, nombre o notas y crea movimiento `manual_adjust`.
  - `DELETE /inventory/items/:id`: remueve/archiva el ítem visible poniendo su cantidad en cero y crea movimiento `manual_remove`; no borra historial físico.
- **Control Multimodal**: Soporte para entrada de voz para eliminar, consumir o ajustar productos (ej: "Borra la leche", "me comí medio pote de casancrem").
- **Gateway de Voz MVP**: `POST /inventory/voice-adjustments` recibe `{ transcript }`. El backend usa IA/parser para convertir el texto en intención estructurada, valida ingrediente/cantidad contra inventario y aplica movimiento `voice_adjust` solo si la confianza es alta. Si la confianza es baja, devuelve una solicitud de confirmación al front antes de modificar inventario.
- **Regla de Seguridad de Voz**: La voz nunca modifica inventario si el backend no está seguro del ingrediente, cantidad o acción.
- **Detección de Sobras**: Registro de **Sobras de Ingrediente** y **Sobras de Comida** tras cocinar (desde la Recipe Experience).
- **Sobras de Ingrediente**: Los ingredientes crudos/remanentes se registran dentro de Inventario como ingredientes normales, con cantidad y confianza estimada cuando corresponda.
- **Sobras de Comida Preparada**: Las porciones de comida ya cocinada se guardan como entidad separada `PreparedLeftover`, con referencia a la comida/receta origen, cantidad de porciones, fecha de guardado, fecha sugerida de consumo y notas opcionales.

## 4. Lógica de Sincronización

- **Realtime MVP**: La lista de compras e inventario no requieren WebSockets en MVP porque la colaboración familiar queda post-MVP. Las actualizaciones se hacen por HTTP y estado local del usuario actual.
- **Realtime Post-MVP**: Cuando existan Family Accounts, shopping list e inventario podrán sincronizar cambios entre dispositivos/miembros mediante Phoenix Channels.
- **Consumo Automático**: Al marcar una receta como "Cocinada", se deducen los ingredientes correspondientes del inventario y se limpian de la lista activa los ítems asociados a esa receta.
- **Inventario Insuficiente al Cocinar**: El inventario no puede quedar negativo. Si una receta requiere más cantidad que la disponible, el backend descuenta hasta cero, registra el `InventoryMovement` con discrepancia y puede avisar al usuario que el inventario estimado fue ajustado.
- **Priorización**: El AI Planner siempre consultará este inventario antes de proponer nuevas recetas.
