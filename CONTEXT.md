# Context: Meal Planning Application

Este documento define el lenguaje ubicuo y los conceptos fundamentales del dominio de la aplicación de planificación de comidas.

## Glosario

### Comida (Meal / MealPlan)
Una instancia específica de alimentación planificada para una fecha y tipo determinado. Contiene una descripción, ingredientes y una receta.

### Tipo de Comida (Meal Type)
Categorización temporal de una **Comida**.
- **Desayuno**: Primera comida del día.
- **Almuerzo**: Comida del mediodía.
- **Cena**: Última comida del día.

### Tipo de Plato (Course Type)
Categorización funcional o estructural de una **Comida**.
- **Principal**: Plato fuerte.
- **Ensalada**: Acompañamiento o plato ligero basado en vegetales.
- **Postre**: Plato dulce al final de una comida.

### Preferencia (Preference)
Inclinación del usuario hacia ciertos sabores, tipos de cocina o ingredientes (ej: "me gusta la comida mediterránea"). No es una regla estricta.

### Restricción (Restriction)
Regla innegociable basada en salud, ética o religión (ej: "celiaquía", "veganismo"). El planificador debe excluir estrictamente cualquier ingrediente que viole esto.

### Inventario (Inventory)
Registro de los ingredientes que el usuario tiene actualmente disponibles en su hogar. Se alimenta de las compras confirmadas.

### Sobra (Leftover)
Término genérico para remanentes que deben ser priorizados en la planificación futura.
- **Sobra de Ingrediente**: Cantidad residual de un ingrediente crudo que no se utilizó completamente (ej: 500g de arroz restantes).
- **Sobra de Comida**: Porciones de un plato ya preparado que no se consumieron y pueden ser recalentadas o transformadas.

### Lista de Compras (Shopping List)
Conjunto de ingredientes necesarios para completar un **Plan de Comidas** que no están presentes en el **Inventario**.

### Consumo Automático (Automatic Consumption)
Deducción de ingredientes del **Inventario** que ocurre cuando una **Comida** se marca como "Cocinada".

### Consumo Manual (Manual Consumption)
Actualización del **Inventario** realizada por el usuario mediante comandos de voz o interfaz táctil para reflejar cambios que no provienen del acto de cocinar (ej: regalar comida, desperdicio accidental).

### Borrador de Plan (Meal Plan Draft)
Una propuesta generada por la IA que aún no ha sido confirmada por el usuario. Es un objeto volátil que puede ser modificado mediante lenguaje natural en el chat antes de convertirse en el plan activo.

### Plan de Comidas Local (Local Meal Plan)
Copia persistente en el dispositivo del plan confirmado por el usuario. Contiene las descripciones y metadatos básicos para la visualización rápida en el Home.

### Receta Local (Local Recipe)
Copia persistente de los ingredientes y pasos de una receta en el dispositivo. Se descarga o genera una vez y queda disponible offline.

### Historial de Chat de Receta (Recipe Chat History)
Registro persistente de los mensajes intercambiados con la IA sobre una receta específica. Permite al usuario consultar dudas pasadas sin necesidad de regenerar la sesión de IA.

### Contexto de Sesión (Session Context)
Conjunto de datos (preferencias, inventario, receta actual) que se envía a la API de IA para que la respuesta sea relevante. Su gestión es crítica para el rendimiento y costo de los tokens.

### Contexto Inyectado (Just-in-Time Context)
Estrategia de arquitectura donde solo se envía a la IA la información relevante a la pantalla o acción actual del usuario, minimizando el uso de tokens.

### Sesión Efímera (Ephemeral Session)
Interacción con la IA que no mantiene un historial persistente a largo plazo. La "memoria" del sistema reside en los datos estructurados (Preferencias, Favoritos) y no en el hilo de conversación anterior.

### Receta Maestra (Master Recipe)
Receta base validada y almacenada en la base de datos global. Se utiliza como plantilla para asegurar la precisión nutricional y evitar alucinaciones de la IA durante la selección del plan.

### Entrada Híbrida (Hybrid Input)
Patrón de interfaz de usuario donde se combinan controles estructurados (ej: sliders para cantidad de días o presupuesto) con un campo de lenguaje natural (chat) para maximizar la eficiencia y precisión en la captura de intenciones.

### Presupuesto (Budget)
Límite económico definido por el usuario para un plan. Puede expresarse de dos formas:
- **Nivel de Gasto**: Preajustes cualitativos (ej: "Muy Barato", "Estándar", "Premium").
- **Presupuesto Total**: Una cantidad numérica específica para la duración total del plan.

### Costo Estimado de Receta (Estimated Recipe Cost)
Valor monetario calculado mediante la suma de los precios promedio de mercado de cada **Ingrediente** necesario para una **Receta Maestra**. Este valor es dinámico y sirve como métrica principal para la alineación con el **Presupuesto**.

### Costo Cero de Inventario (Zero-Cost Inventory)
Regla de negocio donde los ingredientes que ya existen en el **Inventario** (especialmente las **Sobras**) se computan con valor $0 al calcular el **Costo Estimado de Receta** para un nuevo plan, priorizando su uso para minimizar el desperdicio, independientemente de su valor original.

### Receta Personalizada (Customized Recipe)
Una versión de una **Receta Maestra** que ha sido modificada por la IA a pedido del usuario (ej: sustitución de ingredientes). Solo se persiste si se marca como **Favorita**.

### Receta Favorita (Favorite Recipe)
Referencia a una **Receta Maestra** o una **Receta Personalizada** que el usuario ha guardado para uso futuro. Se prioriza en el algoritmo de planificación.

### Mapeo Temático (Thematic Mapping)
Proceso de seleccionar una paleta de colores predefinida basada en los colores dominantes de una imagen generada por IA para aplicar a la UI global.

### Ingrediente Aproximado (Approximate Ingredient)
Sistema de medición que utiliza valores estimados (gramos, mililitros, unidades) para gestionar el **Inventario** y la **Lista de Compras**. Permite una lógica de planificación flexible sin requerir una precisión matemática absoluta por parte del usuario o la IA.
