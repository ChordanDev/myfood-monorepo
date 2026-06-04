# PRD: Recipe Experience (Experiencia de Receta)

## 1. Visión

Proporcionar una interfaz detallada y asistida por IA para la ejecución de recetas, permitiendo al usuario no solo leer los pasos, sino interactuar con un asistente culinario que conoce el contexto de la comida y su inventario.

## 2. Flujo de Navegación

1. **Home (FoodCard)**: El usuario visualiza la descripción de la comida del día/momento.
2. **Acción**: Presiona el botón `SparklesGradientIcon`.
3. **Destino**: Pantalla de Detalle de Receta.

## 3. Funcionalidades Detalladas

### 3.1. Visualización de Receta

- **Interfaz Tematizada**: La paleta de colores de la pantalla se adapta dinámicamente consumiendo el `RecipeThemeConfig` de la receta activa. Esto afecta gradientes de fondo, botones de acción y textos.
- **Ingredientes Aproximados**: Lista con cantidades estimadas.
- **Pasos de Preparación**: Instrucciones detalladas (estructuradas para mejor lectura).

### 3.1.5. Comportamiento Temático Global

La aplicación utiliza un sistema de tematización dinámica basado en las recetas planificadas para el día actual.

- **Alcance Global**: Cuando el usuario selecciona una comida del día **actual** (hoy), el `RecipeThemeConfig` de esa receta se aplica globalmente a toda la aplicación (Home, Perfil, Carrito, etc.).
- **Smart Default**: Al iniciar la aplicación, se evalúa la hora local del usuario para determinar automáticamente la comida relevante ("Desayuno", "Almuerzo", "Cena") y se aplica su tema.
- **Fallback / Días No Actuales**: Si el usuario navega a días pasados o futuros en el calendario, la aplicación revierte temporalmente al tema "Por Defecto" (Default Theme) para mantener la estabilidad visual mientras se planifica.

### 3.2. Chat Contextual de Receta

- **Asistente IA Reactivo**: Chat dedicado para responder preguntas sobre la receta (ej: "¿Por qué se me quemó?", "¿Puedo cambiar el pollo por tofu?") solo cuando el usuario inicia la interacción.
- **Disponibilidad Restringida**: El Chat de IA solo está habilitado para las recetas planificadas para el **día actual**. Si el usuario visita una receta de un día pasado o futuro, podrá ver los ingredientes y pasos, pero la funcionalidad de chat estará deshabilitada.
- **Consciencia de Inventario**: La IA consulta el inventario local para responder dudas sobre sustituciones o faltantes.
- **Persistencia de Chat**: El historial de conversación se guarda localmente para consulta futura.

### 3.3. Acciones de Usuario

- **Marcar como Favorito**: Guarda una referencia reutilizable en la lista personal del usuario. En MVP los favoritos son personales, no pertenecen a la Cuenta.
  - Si la receta es una `MasterRecipe`, el favorito apunta a `masterRecipeId` y no duplica la receta completa.
  - Si la receta es una `Custom Recipe` o un snapshot dentro de un plan, el backend crea una `UserRecipe` con la receta completa y luego crea el favorito apuntando a `userRecipeId`.
  - `FavoriteRecipe` funciona como puntero del usuario; `UserRecipe` representa la receta custom reusable.
  - En MVP, una `UserRecipe` hereda `imageId` y `RecipeThemeConfig` de su `baseMasterRecipeId` cuando existe. Si no tiene receta base, usa placeholder/default. No se generan imágenes ni themes propios para cada custom recipe en MVP.
  - Una `UserRecipe` favorita puede editarse con `PATCH /me/user-recipes/:userRecipeId`. En MVP no hay versionado: se actualiza la receta reusable y su `updatedAt`. Los planes ya confirmados no cambian porque usan snapshots propios.
  - El front usa optimistic UI: marca/desmarca inmediatamente, deja la acción en estado pendiente y revierte si el backend falla.
  - Gateways MVP:
    - `GET /me/favorites`: lista favoritos personales del usuario en formato liviano para cache local y selección en planificación.
    - `GET /me/favorites/:favoriteId`: devuelve receta completa bajo demanda.
    - `POST /me/favorites`: agrega favorito con payload `{ source, sourceId }`, donde `source` puede ser `master_recipe`, `user_recipe` o `plan_recipe_snapshot`.
    - `DELETE /me/favorites/:favoriteId`: elimina un favorito personal.
  - Si `source` es `plan_recipe_snapshot`, el backend crea primero una `UserRecipe` y luego el `FavoriteRecipe`.
  - La respuesta de creación devuelve `favoriteId`, `source`, `masterRecipeId` o `userRecipeId`, título, ingredientes principales y fecha de creación para reconciliar el estado optimista.
  - El cache local de favoritos guarda solo resumen: `favoriteId`, referencia de receta, título, ingredientes principales, duración aproximada, tags, thumbnail opcional y `updatedAt`.
  - El planner recibe favoritos preseleccionados como `preselectedFavorites: [favoriteId]`.
  - Al eliminar un favorito, el backend borra el `FavoriteRecipe`. Si apuntaba a una `MasterRecipe`, no modifica la receta maestra. Si apuntaba a una `UserRecipe`, la receta custom se archiva cuando ya no debe aparecer como reutilizable, pero no se borra físicamente si está referenciada por planes o historial.
  - Deduplicación MVP: un usuario no puede tener dos favoritos con el mismo `masterRecipeId` ni dos favoritos con el mismo `userRecipeId`. Si se repite la operación, el backend devuelve el favorito existente. No se deduplican recetas parecidas por contenido en MVP.
- **Marcar como Cocinado**:
  - Dispara el **Consumo Automático** del inventario.
  - **Registro de Sobras**: Después de marcar cocinado, la app muestra una pregunta liviana: "¿Quedaron sobras?" con opciones rápidas `No`, `Sí, comida preparada` y `Sí, ingredientes`. Si elige comida preparada, se crea `PreparedLeftover`; si elige ingredientes, se ajusta Inventario con sobras de ingrediente.

### 3.4. Edición de Plan (Intercambio de Recetas)

- **Modo Edición del Calendario**: El usuario puede acceder a una vista de edición (mediante un icono de lápiz) que le permite intercambiar comidas entre diferentes días.
- **Acción "Mover a Hoy"**: Al visualizar una receta de un día futuro, el usuario tendrá un botón rápido para "Comer hoy" o "Mover a hoy".
- **Descarga Forzada**: Cualquiera de estas acciones de edición que mueva una receta programada para el futuro al día **actual** disparará inmediatamente la descarga de sus recursos pesados (imagen completa y `RecipeThemeConfig`), reemplazando la atmósfera global de la app y habilitando el Chat IA.

## 4. Persistencia Local y Carga Diferida (Lazy Loading)

- **Carga de Receta Confirmada**: Al confirmar o sincronizar un plan, se descargan localmente los datos completos necesarios para leer y cocinar cada receta del plan: nombre, ingredientes, cantidades, pasos, duración y porciones.
- **Assets Pesados bajo Demanda**: Las imágenes completas y las configuraciones de tema (`RecipeThemeConfig`) se mantienen en la base de datos y solo se descargan al dispositivo el día que corresponde cocinar la receta, al abrir el detalle o mediante precache de hoy/mañana.
- **Placeholders**: En la vista de Home (FoodCard) para días futuros o pasados, se mostrará un placeholder (ej. un diseño neutral o icono) en lugar de la imagen real, indicando que los assets gráficos aún no han sido descargados.
- El historial de chat es persistente por cada comida específica, pero solo se genera para las comidas ejecutadas el día correspondiente.
