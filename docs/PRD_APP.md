# PRD: Aplicación de Planificación de Comidas con IA

## 1. Visión del Producto
Un asistente personal de nutrición "AI-Native" que gestiona el ciclo completo de alimentación: desde la planificación conversacional y la gestión de inventario hasta la preparación de recetas, minimizando el desperdicio de comida mediante el uso inteligente de sobras.

## 2. Pilares de la Experiencia
- **Interfaz Conversacional**: El chat es el motor principal para crear y refinar planes.
- **Consciencia de Inventario**: El sistema "sabe" qué tienes en casa y prioriza su uso.
- **Acompañamiento en Tiempo Real**: Chat especializado por receta para resolver dudas culinarias.
- **Estética Dinámica**: UI que se adapta visualmente al contenido (temas basados en imágenes de IA).

## 3. Funcionalidades Core (MVP)
### 3.1. Planificación Inteligente
- Generación de planes (1-10 días) basados en Preferencias y Restricciones.
- Refinamiento de **Borradores de Plan** mediante lenguaje natural en el chat.
- Guardado de recetas en "Favoritos" para inclusión prioritaria.

### 3.2. Gestión de Suministros e Inventario
- **Lista de Compras**: Generación automática basada en el plan vs. **Inventario**, calculando faltantes mediante **Ingredientes Aproximados**.
- **Inventario Dinámico**: 
    - **Actualización por Compra**: Ingreso automático tras confirmar la lista de compras.
    - **Consumo Automático**: Deducción teórica (estimada en gramos/unidades) al marcar recetas como "Cocinadas".
    - **Control Multimodal**: Ajustes manuales o por voz ("Quita un paquete de fideos") para casos excepcionales.
- **Algoritmo de Sobras**: Identificación de remanentes cuantitativos para priorizar su uso en el siguiente **Borrador de Plan**.

### 3.3. Cocina Asistida e IA
- **Gestión de Recetas**:
    - Uso de **Recetas Maestras** para evitar alucinaciones.
    - Soporte para **Recetas Personalizadas** (modificadas por IA) que solo se guardan si se marcan como **Favoritas**.
- **Vista de Receta con Chat Contextual**: Uso de **Contexto Inyectado** para responder dudas sobre ingredientes o pasos.
- **Estética Dinámica (Rich Aesthetics)**: 
    - Generación de imágenes de platos mediante IA.
    - **Mapeo Temático**: Cambio del tema visual global (paletas de colores) basado en la imagen de la receta actual, afectando principalmente a la Home.

## 4. Definiciones Técnicas Relevantes
- **Persistencia Híbrida**: La base de datos contiene maestros, mientras que el usuario posee su propia colección de favoritos (pudiendo ser versiones modificadas).
- **Gestión de Contexto**: La memoria a largo plazo se almacena en la base de datos (Preferencias, Favoritos, Inventario), no en el historial del chat.
- **Multimodalidad**: Soporte para entrada de voz en la gestión de inventario.
1. El usuario solicita un plan en el chat (ej: "Plan para 3 días, soy vegetariano").
2. La IA presenta un **Borrador de Plan**.
3. El usuario refina ("Cambia la cena del lunes").
4. El usuario confirma el plan -> Se genera la **Lista de Compras**.
5. El usuario confirma la compra -> Se actualiza el **Inventario**.
