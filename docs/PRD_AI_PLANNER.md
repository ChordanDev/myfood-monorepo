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
4. **Refinamiento**: El usuario interactúa mediante lenguaje natural para cambiar comidas o días enteros.
5. **Confirmación**: Al aceptar el borrador, este se convierte en el **Plan de Comidas Local** activo.

## 3. Funcionalidades Detalladas
### 3.1. Motor de Planificación
- **Filtro Estricto**: Exclusión absoluta basada en **Restricciones** del usuario (ej: sin gluten).
- **Alineación de Presupuesto**: Cálculo del **Costo Estimado de Receta** sumando los precios de los ingredientes y comparándolo con el **Presupuesto** del usuario.
- **Optimización de Inventario**: Escaneo de **Sobras** (ingredientes y comidas) para incluirlas obligatoriamente en los primeros días del plan. Se aplica la regla de **Costo Cero de Inventario**, priorizando el uso de ingredientes existentes sin afectar el límite de presupuesto.

### 3.2. Interfaz del Chat de Planificación
- **Renderizado de Plan**: Capacidad del chat para mostrar "tarjetas" del plan semanal integradas en la conversación, no solo texto.
- **Inyección de Favoritas**: El usuario puede solicitar explícitamente incluir una **Receta Favorita** ("Ponme mi receta de tacos para el viernes").

## 4. Salidas (Outputs)
- Actualización de la base de datos de calendario con el nuevo plan.
- Disparo del cálculo de la **Lista de Compras** (Feature separada).
