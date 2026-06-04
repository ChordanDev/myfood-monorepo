# PRD: Aplicación de Planificación de Comidas con IA

## 1. Visión del Producto

Un asistente personal de nutrición "AI-Native" que gestiona el ciclo completo de alimentación: desde la planificación conversacional y la gestión de inventario hasta la preparación de recetas, minimizando el desperdicio de comida mediante el uso inteligente de sobras.

## 2. Pilares de la Experiencia

- **Interfaz Conversacional**: El chat es el motor principal para crear y refinar planes.
- **Consciencia de Inventario**: El sistema "sabe" qué tienes en casa y prioriza su uso.
- **Acompañamiento en Tiempo Real**: Chat especializado por receta para resolver dudas culinarias.
- **Estética Dinámica**: UI que se adapta visualmente al contenido (temas basados en imágenes de IA).

## 3. Funcionalidades Core (MVP)

### 3.0. Alcance de Cuenta para MVP

- El MVP es **individual-first**: cada usuario opera con una **Cuenta Individual**.
- El backend debe modelar una entidad **Cuenta** desde el día 1 para que planes, lista de compras e inventario pertenezcan a `accountId`, no directamente a `userId`.
- En MVP no se incluye planificación familiar, preferencias combinadas entre usuarios, roles familiares ni sincronización colaborativa entre familiares.
- Soporte futuro previsto: **Cuenta Familiar** y **Cuenta Familiar Plus**, donde varios usuarios comparten planificación, lista de compras e inventario.

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
  - **Mapeo Temático Basado en Receta**: Cada `MasterRecipe` incluye una configuración de colores predefinida en la DB (`RecipeThemeConfig`). Al seleccionar una comida en el calendario, la aplicación actualiza dinámicamente: el gradiente del `FoodCard`, el fondo de la pantalla (Home), el contenedor del calendario y los acentos de los botones mediante un `RecipeThemeContext`.

## 4. Definiciones Técnicas Relevantes

- **Backend**: El backend del producto será implementado en Elixir + Phoenix.
- **Autenticación MVP**: El acceso será passwordless mediante código de un solo uso enviado por email. No se usará contraseña en el MVP.
- **Creación de Cuenta MVP**: La app tendrá un flujo explícito de "Crear cuenta". El registro no será silencioso: el usuario ingresa solo su email, confirma el código recibido y recién entonces se crea su Usuario y su Cuenta Individual.
- **Onboarding posterior**: Nombre, restricciones alimentarias, preferencias, nivel de cocina y cantidad de personas para las que cocina se capturan después de la autenticación, no durante la creación inicial.
- **Gateways de Autenticación MVP**:
  - `POST /auth/signup/request-code`: solicita código para crear cuenta; falla si el email ya existe.
  - `POST /auth/signup/verify-code`: valida código y crea `User`, `Individual Account` y sesión.
  - `POST /auth/login/request-code`: solicita código para iniciar sesión; falla si el email no existe.
  - `POST /auth/login/verify-code`: valida código y crea sesión.
  - `POST /auth/refresh`: renueva access token usando refresh token vigente.
  - `POST /auth/logout`: revoca el refresh token de la sesión/dispositivo actual.
  - `GET /me`: devuelve usuario autenticado, cuenta individual activa, rol, estado de onboarding y estado de acceso/prueba/suscripción. No devuelve preferencias completas. El front debe usar `account.access.canUseApp` como bandera principal para permitir o bloquear la app.
  - `PATCH /me/onboarding-profile`: guarda perfil inicial posterior a la autenticación.
  - `GET /me/preferences`: devuelve preferencias y restricciones del usuario.
  - `PATCH /me/preferences`: actualiza preferencias y restricciones del usuario.
  - `DELETE /me/preferences/:id`: elimina una preferencia o restricción del usuario.
- **Sesiones Mobile**: Cada dispositivo tiene su propia sesión con `accessToken` de vida corta y `refreshToken` revocable de vida larga. Cerrar sesión en un dispositivo no cierra automáticamente las demás sesiones.
- **Reglas del Código de Email**: El código es numérico de 6 dígitos, expira en 10 minutos, se guarda solo como hash, permite máximo 5 intentos, un nuevo código invalida el anterior y el reenvío tiene cooldown de 60 segundos. El backend aplica rate limit por email, IP y dispositivo.
- **Errores de Autenticación Esperados**: `code_expired`, `code_invalid`, `too_many_attempts`, `rate_limited`, `email_already_exists`, `email_not_found`.
- **Persistencia Híbrida**: La base de datos contiene maestros, mientras que el usuario posee su propia colección de favoritos (pudiendo ser versiones modificadas).
- **Modelo de Propiedad**: Preferencias y Favoritos pertenecen al usuario; Planes, Lista de Compras e Inventario pertenecen a la Cuenta. En MVP cada usuario tiene una Cuenta Individual.
- **Prueba y Suscripción**: No existe plan gratuito. Toda Cuenta nueva comienza con 10 días de prueba; luego debe tener una suscripción activa para continuar usando la app.
- **Bloqueo por Prueba Expirada**: Si la prueba termina y no hay suscripción activa, la Cuenta queda bloqueada. El usuario puede autenticarse para resolver el pago, pero no puede acceder a las funcionalidades ni a los datos de la app hasta activar una suscripción.
- **Realtime MVP**: En MVP se usan Phoenix Channels solo para progreso/resultados del planner y experiencia conversacional de IA. La colaboración familiar en tiempo real sobre lista de compras e inventario queda fuera del MVP y se reserva para Family Account post-MVP.
- **Contrato de Acceso en `/me`**: La respuesta incluye `account.access.status` (`trialing`, `active`, `locked`), `account.access.reason` (`trial_expired`, `subscription_past_due` o `null`), `trialEndsAt`, `trialDaysRemaining` y `canUseApp`. Si `canUseApp` es `false`, el front debe mostrar paywall/billing y no cargar datos internos.
- **Gestión de Contexto**: La memoria a largo plazo se almacena en la base de datos (Preferencias, Favoritos, Inventario), no en el historial del chat.
- **Multimodalidad**: Soporte para entrada de voz en la gestión de inventario.

1. El usuario solicita un plan en el chat (ej: "Plan para 3 días, soy vegetariano").
2. La IA presenta un **Borrador de Plan**.
3. El usuario refina ("Cambia la cena del lunes").
4. El usuario confirma el plan -> Se genera la **Lista de Compras**.
5. El usuario confirma la compra -> Se actualiza el **Inventario**.
