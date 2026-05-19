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

### 3.2. Chat Contextual de Receta
- **Asistente IA Reactivo**: Chat dedicado para responder preguntas sobre la receta (ej: "¿Por qué se me quemó?", "¿Puedo cambiar el pollo por tofu?") solo cuando el usuario inicia la interacción.
- **Consciencia de Inventario**: La IA consulta el inventario local para responder dudas sobre sustituciones o faltantes.
- **Persistencia de Chat**: El historial de conversación se guarda localmente para consulta futura.

### 3.3. Acciones de Usuario
- **Marcar como Favorito**: Guarda la receta (y sus modificaciones si existen) en la lista personal.
- **Marcar como Cocinado**: 
    - Dispara el **Consumo Automático** del inventario.
    - **Registro de Sobras**: Flujo opcional donde el usuario confirma si quedaron porciones preparadas (**Sobra de Comida**) o si el sistema debe registrar el remanente de ingredientes crudos (**Sobra de Ingrediente**).

## 4. Persistencia Local
- Las recetas se guardan en el dispositivo para acceso offline.
- El historial de chat es persistente por cada comida específica.
