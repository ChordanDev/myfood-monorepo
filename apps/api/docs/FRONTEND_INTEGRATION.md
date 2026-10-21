# MyFood Backend — Frontend Integration Guide

## Versión: 2026-07-11

**Backend Status:** ✅ Production-ready
**Test Suite:** 498 tests, 0 failures
**Last Updated:** 2026-07-11 (Phase A — Tenancy Refactor / multi-familia, PR 3c)

> **La autenticación sigue la spec #1.** El contrato de autenticación que usa la app móvil está definido
> en [ChordanDev/myfood-monorepo#1](https://github.com/ChordanDev/myfood-monorepo/issues/1). La sección
> [Autenticación](#autenticación) lo resume. La sección [Manejo de Errores](#manejo-de-errores) indica qué
> formato de error devuelve hoy cada grupo de endpoints.

---

## Tabla de Contenidos

1. [Configuración Base](#configuración-base)
2. [Autenticación](#autenticación)
3. [API REST](#api-rest)
4. [Multi-Familia (Cuentas Múltiples)](#multi-familia-cuentas-múltiples)
5. [WebSocket (Phoenix Channels)](#websocket-phoenix-channels)
6. [Manejo de Errores](#manejo-de-errores)
7. [Tipos de Datos](#tipos-de-datos)
8. [Ejemplos de Código](#ejemplos-de-código)
9. [FAQ](#faq)

---

## Configuración Base

### URLs por Ambiente

| Ambiente | API URL | WebSocket URL |
|----------|---------|--------------|
| **Development** | `http://localhost:4000` | `ws://localhost:4000/socket` |
| **Staging** | `https://api-staging.myfood.com` | `wss://api-staging.myfood.com/socket` |
| **Production** | `https://api.myfood.com` | `wss://api.myfood.com/socket` |

### Headers Requeridos

```javascript
// Para todas las requests
headers: {
  "Content-Type": "application/json",
  "Authorization": "Bearer <jwt_token>"
}
```

### CORS

✅ **Configurado** — El backend acepta requests desde:
- `http://localhost:8081` (React Native dev)
- `exp://*` (Expo)
- `*` (cualquier origen en desarrollo)

---

## Autenticación

La app inicia sesión y se registra con un código enviado por email, o con Google o Apple (ver
[Login social](#login-social)); no hay login con password. El contrato completo está en la
[spec #1](https://github.com/ChordanDev/myfood-monorepo/issues/1); esta sección lo resume.

- El login atiende solo emails que ya tienen un usuario (`404 email_not_found` si no); el registro
  atiende solo emails que todavía no lo tienen (`409 email_already_exists` si ya existe).
- Los errores de estas rutas usan el sobre `{ "error": { "code": "<código>", "message": "<texto>" } }`.
- Una ruta protegida responde a un token ausente o inválido con ese mismo sobre: `401 unauthenticated`,
  o `401 access_token_expired` cuando el token expiró.

### Flujo JWT

1. **Pedir código** → `POST /api/auth/login/request-code` (o `/api/auth/signup/request-code`)
2. **Verificar código** → Recibir `accessToken` y `refreshToken`
3. **Usar token** → Incluir en header `Authorization: Bearer <accessToken>`
4. **WebSocket** → Pasar el `accessToken` en `params` al conectar
5. **Refresh** → `POST /api/auth/refresh` cuando el access token expire

### Login (ejemplo)

Pedir el código:

```bash
POST /api/auth/login/request-code
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response `200`:**
```json
{
  "status": "code_sent",
  "expiresInSeconds": 600,
  "resendAvailableInSeconds": 60
}
```

Verificar el código de seis dígitos que llegó por email. `deviceId` identifica el teléfono (en la
práctica, un UUID que la app genera y conserva); la sesión que se abre reemplaza a la que ese usuario ya
tenía en ese dispositivo:

```bash
POST /api/auth/login/verify-code
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456",
  "deviceId": "<device_id>"
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "me": {
    "user": {
      "id": "...",
      "email": "user@example.com",
      "displayName": "User Name",
      "householdSize": null,
      "cookingSkill": null
    },
    "account": {
      "id": "...",
      "type": "individual",
      "trialEndsAt": "2026-07-18T12:00:00Z",
      "subscriptionStatus": "none",
      "access": { "canUseApp": true, "reason": null }
    },
    "membership": { "role": "owner" },
    "onboarding": { "isComplete": true }
  }
}
```

`me` es el mismo payload que devuelve `GET /api/me`.

**Errores:** `422 code_invalid` (código incorrecto, o `deviceId` ausente o vacío), `401 code_expired`,
`429 too_many_attempts` (el código quedó bloqueado; pedir uno nuevo), `401 account_not_found` (el usuario
no tiene una membership activa) y `429 rate_limited` (código incorrecto, vencido o bloqueado desde una IP
que acumuló 20 verificaciones fallidas en la última hora; el header `retry-after` trae la espera en
segundos. Un código correcto y vigente nunca es rechazado por este límite; un código incorrecto igual
cuenta como intento sobre el código. Si el código correcto recibe esta respuesta, venció o quedó
bloqueado: pedir uno nuevo). Si la sesión no se puede abrir después de un código correcto, el código no se gasta y se
puede reintentar. Al pedir el código: `422 invalid_email`, `404 email_not_found`, `429 rate_limited` (con
el header `retry-after` en segundos) y `502 code_send_failed` (el código anterior sigue valiendo y se puede
reintentar enseguida: un pedido cuyo email no salió no cuenta para el límite por hora ni para la espera de
60 segundos).

### Registro

Las mismas requests y responses que el login, sobre `POST /api/auth/signup/request-code` y
`POST /api/auth/signup/verify-code`. Verificar el código crea el usuario, su cuenta individual, la
membership `owner` y el trial, y abre la sesión. Pedir el código responde `409 email_already_exists` (en
lugar de `email_not_found`) cuando el email ya tiene un usuario; verificarlo responde lo mismo si el email
pasó a tener un usuario después de enviado el código.

### Login social

`POST /api/auth/social` inicia sesión o registra con el ID token que entrega el SDK de Google (iOS y
Android) o de Apple (solo iOS). La prueba del proveedor reemplaza al código; el resto sigue el contrato
del login y el registro con código.

```json
{ "provider": "google", "idToken": "<ID token del SDK>", "deviceId": "<UUID del dispositivo>" }
```

- `provider` es `google` o `apple`. Con Google, el `idToken` tiene que estar emitido para el web client ID
  que el backend tiene en `GOOGLE_OAUTH_CLIENT_IDS`; con Apple, para el bundle ID de
  `APPLE_OAUTH_CLIENT_IDS`.
- La app muestra el botón de Google solo si el build tiene `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (y, en iOS,
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`); el plugin nativo de Google se agrega en el prebuild cuando está
  `GOOGLE_IOS_URL_SCHEME`. El de Apple, solo en iOS y si el dispositivo lo soporta.
- La respuesta `200` es la de `POST /api/auth/login/verify-code` (`accessToken`, `refreshToken`,
  `tokenType`, `me`) y abre la misma Device session, así que `POST /api/auth/refresh` la renueva.
- La primera vez, la cuenta del proveedor se vincula al usuario del email que el proveedor marca como
  verificado (la dirección de relay privado de Apple cuenta como email real). Si ese email tiene un
  usuario con una membership activa, inicia sesión; si no tiene usuario, se registra con su cuenta
  individual, la membership `owner` y el trial, como `POST /api/auth/signup/verify-code`. Las siguientes
  veces se reconoce la cuenta del proveedor aunque el token no traiga email (Apple lo manda solo la
  primera vez). No hay pantalla para desvincular.
- Errores: `401 social_token_invalid` (token ausente, mal formado, vencido o emitido para otra app;
  también un `deviceId` inválido), `422 social_email_unverified` (la primera vez, sin un email verificado),
  `422 social_provider_unsupported` (otro proveedor, o uno sin client ID configurado),
  `401 account_not_found` (el usuario no tiene una membership activa), `409 email_already_exists` (el
  email pasó a tener un usuario mientras se registraba) y `429 rate_limited` (un token inválido desde una
  IP que ya tiene 20 verificaciones fallidas en la última hora, contadas junto con los códigos por email;
  el header `retry-after` trae la espera en segundos y un token válido nunca se rechaza por este límite).
  Si el proveedor no responde, `500 unknown_error`.

### Renovar y cerrar la sesión

```bash
POST /api/auth/refresh
Content-Type: application/json

{ "refreshToken": "eyJ..." }
```

**Response `200`** — un par nuevo, sin `me`:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "Bearer"
}
```

Cada refresh devuelve un refresh token nuevo: guardarlo y descartar el que se envió. El access token dura
1 hora y el refresh token 30 días.

Si la respuesta de un refresh no llegó, se puede reenviar el mismo token durante 10 segundos: devuelve
un par nuevo y el par de la respuesta perdida deja de servir, así que siempre hay que guardar el par de
la última respuesta recibida. Pasados esos 10 segundos, un refresh token que ya se usó recibe
`401 refresh_token_replayed` y se revocan las sesiones de ese dispositivo. El cliente sigue teniendo
que serializar el refresh: una sola llamada en vuelo, compartida por todos los requests que
encontraron el access token vencido.

**Errores (todos `401`):** `refresh_token_invalid`, `refresh_token_replayed`, `refresh_token_revoked`,
`refresh_token_expired`, `refresh_token_session_mismatch` y `account_not_found` (la membership de la
sesión ya no está activa).

`POST /api/auth/logout` recibe el mismo body `{ "refreshToken" }`, no requiere access token y responde
`204` sin cuerpo.

### Conectar WebSocket con Token

```javascript
import { Socket } from "phoenix";

const socket = new Socket("/socket", {
  params: { token: "<jwt_token>" }
});

socket.connect();
```

### Token `access_v2` (Phase A — Multi-Familia)

A partir de Phase A ("Tenancy Refactor"), el backend puede emitir dos
tipos de token: el legacy `access` (una sola cuenta implícita) y el
nuevo `access_v2`, que carga explícitamente a qué `AccountMembership`
está ligado el token. Esto es lo que permite el modelo "Spotify
Family": un mismo usuario puede tener membership en varias cuentas
(familias) y elegir cuál está activa sin volver a loguearse — ver
[Multi-Familia](#multi-familia-cuentas-múltiples).

El frontend **no necesita decodificar el JWT** para saber qué cuenta
está activa — el backend siempre responde con `membership` y `account`
serializados en el body (ver ejemplos abajo). Pero para debugging, el
claim shape es:

```json
{
  "sub": "<user_id>",
  "typ": "access_v2",
  "membership_id": "<account_membership_id>",
  "account_id": "<account_id>",
  "role": "owner",
  "plan": "family_4",
  "status": "active",
  "email": "user@example.com",
  "name": "User Name",
  "iat": 1700000000,
  "exp": 1700003600
}
```

El login, el registro y el refresh con código emiten siempre
`access_v2`. Cuál tipo de token emiten aceptar una invitación y
`switch-account` depende de una feature flag del lado del servidor
(`MEAL_PLANNER_TENANCY_V2`) — el frontend debe tratar ambos tipos de
forma transparente (mismo header `Authorization: Bearer <token>`) y NO
asumir un tipo específico.

---

## API REST

### Endpoints Disponibles

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/auth/login/request-code` | Pedir código de login por email |
| `POST` | `/api/auth/login/verify-code` | Verificar el código e iniciar sesión |
| `POST` | `/api/auth/signup/request-code` | Pedir código de registro por email |
| `POST` | `/api/auth/signup/verify-code` | Verificar el código y crear la cuenta |
| `POST` | `/api/auth/social` | Iniciar sesión o registrarse con Google o Apple |
| `POST` | `/api/auth/refresh` | Renovar la sesión |
| `POST` | `/api/auth/logout` | Cerrar la sesión |
| `GET` | `/api/me` | Usuario actual |
| `GET` | `/api/calendar` | Obtener calendario mensual |
| `GET` | `/api/calendar/slot?date=YYYY-MM-DD&slot=breakfast` | Obtener slot específico |
| `POST` | `/api/calendar/meals/:mealId/confirm` | Confirmar si una comida pasada se cocinó |
| `POST` | `/api/planning/generate` | Generar plan semanal |
| `POST` | `/api/planning/confirm` | Confirmar propuesta |
| `GET` | `/api/shopping/list` | Lista de compras |
| `POST` | `/api/shopping/checkout` | Confirmar compra |
| `GET` | `/api/recipes` | Lista de recetas |
| `GET` | `/api/inventory` | Inventario del usuario |
| `GET` | `/api/ingredients?query=leche` | Buscar Ingredientes del catálogo por nombre |
| `PUT` | `/api/me/profile` | Editar el perfil de Onboarding del usuario actual |
| `GET` | `/api/me/favorites` | Recetas favoritas del usuario actual |
| `POST` | `/api/me/favorites` | Marcar una receta como favorita (idempotente) |
| `DELETE` | `/api/me/favorites/:recipeId` | Quitar una receta de los favoritos |
| `GET` | `/api/account/budget` | Presupuesto semanal de la cuenta |
| `PUT` | `/api/account/budget` | Cambiar el presupuesto semanal (solo `owner`) |
| `GET` | `/api/billing/revenuecat/status` | Estado de acceso de la cuenta y su `app_user_id` de RevenueCat |
| `POST` | `/api/billing/revenuecat/purchase` | Confirmar el estado después de una compra en el SDK |
| `POST` | `/api/billing/revenuecat/restore` | Confirmar el estado después de restaurar compras en el SDK |

### Editar el perfil de Onboarding

`PUT /api/me/profile` guarda el nombre, el tamaño del hogar y la experiencia cocinando del usuario actual.
No requiere acceso vigente: una cuenta con el acceso vencido también puede usarla.

```json
{
  "displayName": "Ana María",
  "householdSize": 4,
  "cookingSkill": "intermediate"
}
```

Los tres campos son obligatorios:

- `displayName`: string de 1 a 64 caracteres, contados después de quitar los espacios de los extremos.
  Un carácter es un grafema (un emoji compuesto cuenta como uno); además el nombre no puede superar los
  255 code points Unicode ni contener el carácter NUL (`\u0000`).
- `householdSize`: entero JSON de 1 a 20. El string `"4"` y el número `4.5` se rechazan.
- `cookingSkill`: `beginner`, `intermediate` o `advanced`.

Respuesta `200`, con el mismo objeto `user` que devuelve `GET /api/me`:

```json
{
  "user": {
    "id": "…",
    "email": "ana@example.com",
    "displayName": "Ana María",
    "householdSize": 4,
    "cookingSkill": "intermediate"
  }
}
```

Los campos se validan en el orden `displayName`, `householdSize`, `cookingSkill`, y el primero que falla
decide la respuesta: `422 invalid_cooking_skill` cuando `cookingSkill` es un string fuera del catálogo, y
`422 validation_error` en cualquier otro caso, con un `message` que nombra el campo. Una request rechazada
no guarda nada.

### Favoritos

Los favoritos son del usuario dentro de la cuenta activa: otro miembro de la misma cuenta no los ve.
Las tres rutas comparten la exención de `/api/me`: una cuenta con el acceso vencido también puede usarlas.
Escribir un favorito por estas rutas o por el evento `toggle_favorite` del canal de calendario toca la
misma fila, así que cada uno ve lo que hizo el otro.

`GET /api/me/favorites` responde `200` con los resúmenes ordenados por nombre (lista vacía si no hay
ninguno, nunca `404`). `mainIngredients` trae hasta tres nombres, los de mayor cantidad; `durationMinutes`
es preparación más cocción y `null` si la receta no tiene ninguna.

```json
{
  "data": [
    {
      "recipeId": "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8",
      "name": "Tortilla de papas",
      "mainIngredients": ["Papa", "Aceite de girasol", "Huevo"],
      "durationMinutes": 40
    }
  ]
}
```

`POST /api/me/favorites` con `{ "recipeId": "…" }` es idempotente: responde `200` con
`{ "data": <resumen> }` tanto si lo agregó ahora como si ya era favorito. Un `recipeId` ausente o que no es
string da `422 validation_error`; una receta inexistente, con id mal formado o de otra cuenta da
`404 recipe_not_found`.

`DELETE /api/me/favorites/:recipeId` responde `204` sin cuerpo, aunque la receta no fuera favorita.

### Buscar Ingredientes

`GET /api/ingredients?query=leche` busca en el catálogo de Ingredientes, que es el mismo para todas las
cuentas. Es la lista de la que la app elige el Ingrediente que agrega al inventario: `POST
/api/inventory/items/add-extra` recibe su `id` como `ingredientId`.

- `query` se recorta y debe tener entre 1 y 100 caracteres. Uno ausente, vacío o más largo da
  `422 validation_error`, con un `message` que nombra `query`.
- Encuentra los nombres que contienen `query` sin distinguir mayúsculas. `%` y `_` se buscan tal cual.
- Responde a lo sumo 20 Ingredientes: primero los nombres que empiezan con `query`, después el resto, y
  cada grupo por nombre. Sin coincidencias responde `200` con una lista vacía.
- Requiere acceso vigente, como el resto de las rutas del inventario.

```json
{
  "data": [
    { "id": "6f1d2c3b-4a59-4e68-8a77-1b2c3d4e5f60", "name": "Leche entera" },
    { "id": "7a2e3d4c-5b6a-4f79-9b88-2c3d4e5f6071", "name": "Dulce de leche" }
  ]
}
```

### Ejemplo: Obtener Calendario

```bash
GET /api/calendar?month=2026-06
Authorization: Bearer <token>
```

**Response:**
```json
{
  "meals": [
    {
      "id": 123,
      "date": "2026-06-03",
      "slot": "lunch",
      "recipe_id": 45,
      "recipe_name": "Pollo al horno",
      "calories_per_serving": 450,
      "prep_time_minutes": 35,
      "is_favorite": false,
      "is_cooked": false,
      "can_create": false
    }
  ],
  "selected_date": "2026-06-03",
  "selected_meal": {
    "id": 123,
    "date": "2026-06-03",
    "slot": "lunch",
    "recipe_id": 45,
    "recipe_name": "Pollo al horno",
    "can_create": false
  }
}
```

### Confirmar una comida pasada

Una comida cuyo día ya pasó (según el "hoy" de la cuenta), hace 7 días o menos, que no se
cocinó ni se respondió, está **sin confirmar**. El usuario la confirma una sola vez:

```bash
POST /api/calendar/meals/:mealId/confirm
Authorization: Bearer <token>
Content-Type: application/json

{ "cooked": true }
```

- `cooked: true`: los Ingredientes de la receta se descuentan del Inventario (lote más viejo
  primero, sin bajar de cero), se borran sus Shopping items abiertos y la comida queda cocinada.
  No abre una Cooking session.
- `cooked: false`: se guarda la respuesta y no se descuenta nada; la comida queda salteada.

La respuesta tiene la forma del cierre de una Cooking session. Un faltante no hace fallar la
confirmación: se informa en `shortages`, uno por Ingrediente que el stock no cubrió.

```json
{
  "data": {
    "scheduledMeal": { "id": "…", "date": "2026-10-19", "slot": "lunch", "isCooked": true, "isSkipped": false, "recipeId": "…", "recipeVersionId": "…", "selectedQuantity": 1, "recipeName": "Pollo al horno" },
    "inventoryMutations": [{ "inventoryItemId": "…", "ingredientId": "…", "ingredientName": "Arroz", "unit": "g", "quantityBeforeMilli": 1000, "quantityDeltaMilli": -200, "quantityAfterMilli": 800 }],
    "shortages": [{ "ingredientId": "…", "ingredientName": "Sal", "unit": "g", "requestedMilli": 200, "missingMilli": 150 }]
  }
}
```

Con `cooked: false`, `scheduledMeal.isSkipped` es `true` e `inventoryMutations` y `shortages`
vienen vacíos.

| Estado | Código | Cuándo |
|--------|--------|--------|
| 404 | `scheduled_meal_not_found` | La comida no existe o es de otra cuenta |
| 409 | `meal_already_confirmed` | La comida ya estaba cocinada o confirmada como no cocinada; no se cambia ni se descuenta nada |
| 422 | `confirmation_window_closed` | La comida es de hoy o posterior (se cocina con una Cooking session), o de hace más de 7 días |
| 422 | `validation_error` | `cooked` falta o no es booleano |

En `GET /api/calendar`, `isSkipped` sigue esta regla: una comida pasada sin cocinar tiene
`isSkipped: true` si se confirmó como no cocinada o si pasaron más de 7 días sin respuesta; dentro
de esos 7 días, sin respuesta, tiene `isCooked: false` e `isSkipped: false` (sin confirmar). Las
dos respuestas se leen igual desde cualquier dispositivo de la cuenta.

### Presupuesto semanal de la cuenta

El presupuesto semanal es de la cuenta: todos los miembros lo leen y solo el `owner` lo cambia.
Mientras la cuenta no guardó uno, vale el presupuesto por defecto de su tier y `isDefault` es
`true`.

```bash
GET /api/account/budget
Authorization: Bearer <token>
```

```bash
PUT /api/account/budget
Authorization: Bearer <token>
Content-Type: application/json

{ "weeklyBudgetCents": 60000 }
```

Las dos responden lo mismo:

```json
{
  "budget": {
    "weeklyBudgetCents": 60000,
    "isDefault": false,
    "minWeeklyBudgetCents": 30000,
    "currency": "ARS"
  }
}
```

- `weeklyBudgetCents`: el presupuesto que usa la generación de planes, en centavos.
- `minWeeklyBudgetCents`: lo mínimo que acepta `PUT`. Es un monto por persona (configuración
  del servidor, hoy `0`) por el tamaño del hogar del `owner`; si el `owner` no lo cargó, cuenta
  como una persona.
- `weeklyBudgetCents` en `PUT` es un entero de centavos mayor que `0` y no menor que
  `minWeeklyBudgetCents`. Una vez guardado, no se vuelve al valor por defecto, así que el cliente no
  envía `PUT` si el owner guarda el mismo monto que ya ve: un presupuesto por defecto sigue al tier.

| Estado | Código | Cuándo |
|--------|--------|--------|
| 403 | `not_owner` | `PUT` de un miembro que no es el `owner`, sea cual sea el body |
| 422 | `validation_error` | `weeklyBudgetCents` falta, no es entero, es `0` o menos, o es menor que `minWeeklyBudgetCents`; no se guarda nada |

### Suscripción (RevenueCat)

La suscripción es de la cuenta, no del dispositivo ni del usuario. Estas tres rutas responden
aunque el trial de la cuenta haya vencido, para que la app pueda cobrar o restaurar.

```bash
GET /api/billing/revenuecat/status
Authorization: Bearer <token>
```

```json
{
  "data": {
    "state": "trial",
    "source": "trial",
    "trial_started_at": "2026-10-14T12:00:00Z",
    "trial_ends_at": "2026-10-21T12:00:00Z",
    "latest_provider_event_at": null,
    "app_user_id": "5b0c8f3e-2f7d-4c1a-9e2b-7d1f4a6c3e90"
  }
}
```

- `app_user_id`: el id con el que la app hace `Purchases.logIn` en RevenueCat. Lo emite el
  servidor en la primera llamada de la cuenta (un UUID al azar, no derivado de la cuenta ni del
  email) y desde ahí es siempre el mismo para todos los miembros. Al cambiar de cuenta, la app
  vuelve a leerlo y hace `logIn` con el de la nueva. Solo es `null` si el servidor no pudo
  guardarlo; en ese caso la app no compra.
- `state`: `trial`, `active` o `expired`. Es la fuente de verdad del acceso; la app no habilita
  nada por su cuenta a partir del `CustomerInfo` del SDK.

Después de que el SDK completa una compra o una restauración, la app llama sin body a
`POST /api/billing/revenuecat/purchase` o `POST /api/billing/revenuecat/restore`. Responden `200`
con `state` y `source` cuando el webhook de RevenueCat ya habilitó la cuenta, y
`202 {"data": {"state": "pending_webhook"}}` mientras no llegó; la app reintenta con backoff.

| Estado | Código | Cuándo |
|--------|--------|--------|
| 422 | `client_entitlement_grant_forbidden` | `purchase` o `restore` con datos de entitlement o recibo en el body; solo el webhook firmado habilita una cuenta |

### Ejemplo: Generar Plan

```bash
POST /api/planning/generate
Authorization: Bearer <token>

{
  "date_from": "2026-06-10",
  "date_to": "2026-06-16",
  "constraints": {
    "budget_cents": 15000,
    "protein_g": 30,
    "max_calories": 800
  }
}
```

**Response:**
```json
{
  "proposal_id": 789,
  "request_id": "req_12345",
  "status": "generating"
}
```

---

## Multi-Familia (Cuentas Múltiples)

Phase A ("Tenancy Refactor") agrega el modelo "Spotify Family para meal
plans": un mismo `User` puede tener `AccountMembership` en varias
cuentas ("familias"), con un rol por cuenta (`owner` o `member`). La
cuenta activa la determina el JWT (`membership_id`), y cambiar de cuenta
activa es simplemente pedir un JWT nuevo — no hay "tomar control" ni
"transferir" cuentas entre usuarios.

Todos los endpoints de esta sección requieren `Authorization: Bearer
<token>`, salvo donde se indique lo contrario.

### Tabla de endpoints nuevos

| Método | Endpoint | Descripción | Rol requerido |
|--------|----------|-------------|----------------|
| `POST` | `/api/accounts/:account_id/invites` | Invitar por email | `owner` |
| `POST` | `/api/invites/:token/code` | Mandar un código al email invitado | — (sin auth) |
| `POST` | `/api/invites/:token/accept` | Aceptar invitación | — (sin auth) |
| `GET` | `/api/accounts/:account_id/memberships` | Listar miembros | cualquier miembro activo |
| `DELETE` | `/api/accounts/:account_id/memberships/:user_id` | Remover miembro | `owner` |
| `POST` | `/api/auth/switch-account` | Cambiar cuenta activa | cualquiera (dueño de la membership) |
| `POST` | `/api/accounts/:account_id/leave` | Abandonar la cuenta | `member` (el `owner` no puede) |

### 1. Invitar a un miembro

```bash
POST /api/accounts/:account_id/invites
Authorization: Bearer <owner_token>
Content-Type: application/json

{ "email": "ana@example.com" }
```

**Response `201`:**
```json
{
  "invite": {
    "token": "8f3d9e2a...43-char-plaintext-token",
    "expires_at": "2026-07-18T12:00:00Z",
    "membership_id": "3b9d2f4a-...",
    "email": "ana@example.com"
  }
}
```

El `token` plaintext se muestra **una sola vez** — el backend solo
guarda su hash. El frontend debe compartirlo con el invitado (deep
link, copiar/compartir, etc.) inmediatamente después de recibirlo.

**Errores:**

| Status | `error` | Causa | Acción recomendada |
|--------|---------|-------|---------------------|
| `403` | `not_owner` | El caller no es `owner` de la cuenta | Ocultar la opción de invitar para `member` |
| `409` | `seat_cap_reached` | La cuenta llegó al límite de su plan | Mostrar upsell / cambio de plan |
| `409` | `already_invited` | Ya hay una invitación `:invited` pendiente para ese email | Mostrar "ya invitado", ofrecer reenviar |

### 2. Aceptar una invitación

**Deliberadamente NO requiere `Authorization`** — el invitado puede no
tener sesión. Tener el token no alcanza para entrar: el invitado
demuestra que es dueño del email invitado. Quién puede aceptar y cómo:

- **Con el código mandado al email invitado:** cualquier invitado, tenga
  o no cuenta en MyFood (ver [Aceptar con código](#aceptar-con-código)).
  Es la única forma para un email sin cuenta y para un usuario sin sesión
  (por ejemplo, alguien que fue removido de su única cuenta y no puede
  iniciar sesión porque ya no tiene membership activa).
- **Con su propio `Authorization`:** un usuario con sesión que es el
  invitado. Con el token de otro usuario la respuesta es
  `403 invite_for_another_user`.

Sin `code` y sin `Authorization` válido la respuesta es
`401 unauthorized`, aunque el body traiga `name`: no se crea sesión y la
invitación sigue pendiente.

**Usuario con sesión** (manda su `Authorization` header actual; tiene
que ser el usuario invitado):
```bash
POST /api/invites/:token/accept
Authorization: Bearer <existing_user_token>   # obligatorio
Content-Type: application/json

{}
```

#### Aceptar con código

Sirve para cualquier invitación: la de un email sin cuenta y la de un
usuario que ya tiene cuenta pero no tiene sesión. Primero se pide el
código:

```bash
POST /api/invites/:token/code
Content-Type: application/json

{}
```

El código va **siempre** al email al que se mandó la invitación; el
body se ignora, así que no hay forma de mandarlo a otra dirección.

**Response `200`:**
```json
{ "status": "code_sent", "expires_in_seconds": 600, "resend_available_in_seconds": 60 }
```

Comparte los límites del login con código: un reenvío cada 60 segundos
por email y los límites por hora por email y por IP.

| Status | `error` | Causa | Acción recomendada |
|--------|---------|-------|---------------------|
| `404` | `invite_token_unknown` | Token inválido/no existe | Mostrar "invitación inválida" |
| `410` | `invite_token_used` | El token ya fue usado antes | Mostrar "invitación ya usada", pedir una nueva |
| `410` | `invite_token_expired` | Pasaron más de 7 días desde la invitación | Pedir al `owner` que reenvíe |
| `429` | `rate_limited` | Reenvío antes de 60 s, o límite por hora agotado. Header `retry-after` en segundos | Esperar `retry-after` |
| `502` | `code_send_failed` | No se pudo mandar el email | Reintentar enseguida |

Después se acepta con el código:

```bash
POST /api/invites/:token/accept
Content-Type: application/json

{ "code": "123456", "deviceId": "6f1c2d3e-4a5b-4c6d-8e7f-901234567890", "name": "Ana Pérez" }
```

`deviceId` es el mismo que manda el login con código (el UUID que la app
genera para el teléfono).

`name` es opcional. Si es un string no vacío y el email invitado todavía
no tiene cuenta, la cuenta que se crea al aceptar queda con ese nombre.
Si el email ya tiene cuenta, `name` se ignora y el usuario conserva su
nombre. El `name` se guarda sin los espacios de los extremos y sigue las
reglas del `displayName` del perfil: de 1 a 64 caracteres (grafemas), sin
superar los 255 code points Unicode ni contener el carácter NUL
(`\u0000`). Un `name` que no es un string o que no cumple esas reglas
(vacío, solo espacios, demasiado largo) se ignora como cualquier otra
clave. Sin `name`, un email sin cuenta queda con su email como
nombre. La invitación no pide password: después el usuario inicia
sesión con un código enviado por email, igual que el resto. Cualquier
otra clave del body se ignora.

Si el body trae la clave `code`, con cualquier valor, se usa el código:
se ignora el `Authorization`. Solo sirve el último código pedido por este endpoint
para ese email; un código del login o del sign-up no acepta una
invitación, y un código de invitación no inicia sesión. Si es correcto,
la membership queda `active` y el invitado queda con la sesión iniciada
igual que con el login con código: la respuesta es la del
[login](#login-ejemplo), no el `200` de abajo, y abre una sesión de
dispositivo que se renueva con `POST /api/auth/refresh`.

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "Bearer",
  "me": { "user": { "id": "..." }, "account": { "id": "..." }, "membership": { "role": "member" } }
}
```

`me` es el mismo payload que devuelve `GET /api/me`; `me.user.displayName`
trae el nombre con el que quedó el usuario.

Errores propios del código (además de los de la tabla de abajo):

| Status | `error` | Causa | Acción recomendada |
|--------|---------|-------|---------------------|
| `422` | `code_invalid` | Código incorrecto, no hay código pendiente para esta invitación, `code` no es un string con texto (un número, `null` o `""`), o falta `deviceId` o está vacío (en ese caso el código no se gasta) | Pedir que lo revise o pedir otro |
| `401` | `code_expired` | Pasaron más de 10 minutos | Pedir otro código |
| `429` | `too_many_attempts` | 5 intentos fallidos con este código; ya no sirve, ni el correcto | Pedir otro código |
| `429` | `rate_limited` | Código incorrecto, vencido o bloqueado, y demasiados códigos fallidos desde esta IP en la última hora; un código correcto y vigente entra igual. Header `retry-after` | Pedir que revise el código: el correcto y vigente entra igual. Si ya lo revisó, pedir otro código |

**Response `200`** (con `Authorization`) — con la membership recién aceptada:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "Bearer",
  "user": { "id": "...", "email": "ana@example.com", "name": "Ana Pérez" },
  "account": { "id": "...", "name": "Familia Pérez", "plan": "family_4" },
  "membership": {
    "id": "3b9d2f4a-...",
    "account_id": "...",
    "role": "member",
    "status": "active",
    "joined_at": "2026-07-11T18:22:00Z"
  },
  "subscription": { "max_users": 4, "max_planning_days": 5 },
  "websocket": { "path": "/socket/websocket", "params": { "token": "eyJ..." } }
}
```

Guardar el `access_token` — a partir de acá el usuario ya está
autenticado y puede usar el resto de la API con esta nueva cuenta
activa. Esta respuesta no usa el shape del login con código (ver
[Login](#login-ejemplo)), y su `refresh_token` no pertenece a una
sesión de dispositivo: `POST /api/auth/refresh` lo rechaza con
`401 refresh_token_invalid`. Cuando el `access_token` expira, el
usuario vuelve a iniciar sesión con un código.

**Errores:**

| Status | `error` | Causa | Acción recomendada |
|--------|---------|-------|---------------------|
| `401` | `unauthorized` | Body sin `code` y sin `Authorization` válido (también con `name`) | Aceptar con código, o pedir login y reintentar con el token |
| `403` | `invite_for_another_user` | El `Authorization` es de un usuario distinto del invitado | Mostrar "esta invitación es para otro email" |
| `410` | `invite_token_used` | El token ya fue usado antes | Mostrar "invitación ya usada", pedir una nueva |
| `410` | `invite_token_expired` | Pasaron más de 7 días desde la invitación | Pedir al `owner` que reenvíe |
| `404` | `invite_token_unknown` | Token inválido/no existe | Mostrar "invitación inválida" |
| `409` | `already_a_member` | Carrera: dos aceptaciones simultáneas del mismo invite | Tratar como éxito silencioso (reintentar login) |

### 3. Listar miembros de una cuenta

```bash
GET /api/accounts/:account_id/memberships
Authorization: Bearer <token>
```

**Response `200`:**
```json
{
  "memberships": [
    {
      "user_id": "...",
      "email": "owner@example.com",
      "name": "Owner Name",
      "role": "owner",
      "status": "active",
      "joined_at": "2026-06-01T10:00:00Z"
    },
    {
      "user_id": "...",
      "email": "ana@example.com",
      "name": "Ana Pérez",
      "role": "member",
      "status": "active",
      "joined_at": "2026-07-11T18:22:00Z"
    }
  ]
}
```

Ordenado `owner` primero, luego por fecha de ingreso. Incluye filas
`:invited` (todavía no aceptadas) para que la UI pueda mostrar
"invitación pendiente".

**Errores:** `404 account_not_found` (no-miembros reciben 404, no 403 —
no hay leak de existencia de la cuenta); `403 account_mismatch` si el
`:account_id` de la URL no coincide con la cuenta activa del token (ver
[Manejo de Errores](#manejo-de-errores)).

### 4. Remover un miembro (solo `owner`)

```bash
DELETE /api/accounts/:account_id/memberships/:user_id
Authorization: Bearer <owner_token>
```

**Response:** `204 No Content`.

**Errores:** `403 not_owner`, `403 cannot_remove_owner` (el `owner` no
puede auto-removerse por esta vía), `404 membership_not_found`.

### 5. Cambiar de cuenta activa (switch-account)

```bash
POST /api/auth/switch-account
Authorization: Bearer <token>
Content-Type: application/json

{ "membership_id": "<other_account_membership_id>" }
```

**Response `200`** — mismo shape completo que "Aceptar invitación"
arriba (`access_token`, `refresh_token`, `user`, `account`, `membership`,
`subscription`, `websocket`), pero ahora escoged a la OTRA cuenta.

```javascript
async function switchAccount(membershipId) {
  const token = await AsyncStorage.getItem("auth_token");
  const response = await fetch("http://localhost:4000/api/auth/switch-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ membership_id: membershipId })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error);

  // Reemplazar el token guardado — TODAS las requests/sockets
  // subsiguientes deben usar este nuevo token.
  await AsyncStorage.setItem("auth_token", data.access_token);
  await AsyncStorage.setItem("account", JSON.stringify(data.account));
  return data;
}
```

**Importante:** después de un switch exitoso, cualquier WebSocket ya
conectado con el token viejo sigue funcionando para la cuenta vieja,
pero para operar sobre la cuenta nueva hay que **reconectar el socket
con el nuevo token** (ver
["Patrón de dos sockets"](#patrón-de-dos-sockets-multi-familia) abajo).

**Errores:**

| Status | `error` | Causa | Acción recomendada |
|--------|---------|-------|---------------------|
| `403` | `not_your_membership` | El `membership_id` pertenece a otro usuario | No debería pasar desde la UI normal — bug de cliente |
| `409` | `membership_not_active` | La membership está `:suspended` (no `:invited`/`:active`) | Mostrar "acceso suspendido a esta cuenta" |
| `404` | `membership_not_found` | El `membership_id` no existe | No debería pasar desde la UI normal |

### 6. Abandonar una cuenta (solo `member`, no `owner`)

```bash
POST /api/accounts/:account_id/leave
Authorization: Bearer <token>
```

**Response:** `204 No Content`. El usuario pierde acceso inmediato a
esa cuenta — si tenía otras membership activas, debe hacer
switch-account a alguna de ellas.

**Errores:** `403 cannot_leave_owned_account` (el `owner` debe primero
transferir ownership o eliminar la cuenta — no soportado todavía),
`404 not_a_member`.

---

## WebSocket (Phoenix Channels)

### Canales Disponibles

| Canal | Tópico | Propósito |
|-------|--------|----------|
| `ai_chat` | `ai_chat:<session_id>` | Asistente AI de meal planning |
| `calendar` | `calendar:<account_id>` | Operaciones de calendario en tiempo real |
| `planning` | `planning:<account_id>` | Generación de planes y confirmación |

### Canal de Planificación (para generar menús)

```javascript
// 1. Conectar al canal de planificación
const planningChannel = socket.channel("planning:1", {});

// 2. Unirse al canal
planningChannel.join()
  .receive("ok", resp => console.log("Joined!", resp))
  .receive("error", resp => console.log("Unable to join", resp));

// 3. Escuchar eventos de generación
planningChannel.on("generation_started", payload => {
  console.log("Generando menú...", payload);
});

planningChannel.on("proposal_ready", payload => {
  console.log("Propuesta lista!", payload);
  // payload.proposalId para confirmar/rechazar por HTTP
});

// 4. Abrir la sesión de planificación y su primera generación
planningChannel.push("start_planning", {
  rangeFrom: "2026-06-10",
  rangeTo: "2026-06-16",
  request: "algo liviano, sin pescado"
});
```

El tópico `planning:<account_id>` solo acepta los comandos de sesión
(`start_planning`, `send_message`, `cancel_planning`). Confirmar y rechazar
son requests HTTP (`POST /api/planning/confirm`,
`POST /api/planning/proposals/:proposalId/reject`); los comandos viejos
`generate_menu`, `swap_constraints`, `chat`, `confirm_proposal` y
`reject_proposal` responden `invalid_payload`. Ver `docs/CHANNELS.md`.

### Canal de Calendario

```javascript
// 1. Conectar al canal de calendario
const calendarChannel = socket.channel("calendar:1", {});

// 2. Unirse
calendarChannel.join();

// 3. Escuchar cambios
calendarChannel.on("meal_updated", payload => {
  console.log("Meal actualizado:", payload);
  // Actualizar UI
});

// 4. Marcar comida como cocinada. Como al terminar una sesión de cocina, el
//    servidor descuenta los ingredientes del Inventario (eventos `cooking`)
//    y quita los ítems abiertos de la lista de compras. Marcar de nuevo una
//    comida ya cocinada no descuenta otra vez; desmarcarla (`is_cooked: false`)
//    no devuelve el stock.
calendarChannel.push("set_is_cooked", {
  meal_id: 123,
  is_cooked: true
})
  .receive("ok", resp => console.log("Marcado!"))
  .receive("error", resp => console.log("Error:", resp));

// 5. Toggle favorito
calendarChannel.push("toggle_favorite", {
  recipe_id: "45"
})
  .receive("ok", resp => console.log("Favorito toggled!", resp));
```

### Patrón de dos sockets (multi-familia)

Cada canal de datos (`calendar:<account_id>`, `planning:<account_id>`,
etc.) valida en el `join` que el token conectado tenga
`current_membership.account_id` igual al `<account_id>` del tópico —
igual que las rutas REST. Un usuario multi-familia que necesita ver
actualizaciones en tiempo real de **dos cuentas simultáneamente** (por
ejemplo, un dashboard que muestra ambas familias) necesita **dos
sockets separados, cada uno conectado con el token de la cuenta
correspondiente** — un solo socket/token solo puede unirse a tópicos de
la cuenta a la que ese token está scoped.

```javascript
import { Socket } from "phoenix";

// Socket 1 — token scoped a Account A
const tokenA = await getTokenForMembership(membershipIdA); // switch-account si hace falta
const socketA = new Socket("/socket", { params: { token: tokenA } });
socketA.connect();
const calendarA = socketA.channel(`calendar:${accountIdA}`, {});
calendarA.join().receive("ok", () => console.log("Joined Account A calendar"));

// Socket 2 — token scoped a Account B (independiente del anterior)
const tokenB = await getTokenForMembership(membershipIdB);
const socketB = new Socket("/socket", { params: { token: tokenB } });
socketB.connect();
const calendarB = socketB.channel(`calendar:${accountIdB}`, {});
calendarB.join().receive("ok", () => console.log("Joined Account B calendar"));

// Cada socket solo recibe broadcasts de SU propia cuenta — un evento
// en calendar:<accountIdA> nunca llega a calendarB, y viceversa.
calendarA.on("meal_updated", payload => updateAccountAUI(payload));
calendarB.on("meal_updated", payload => updateAccountBUI(payload));
```

Para el caso normal (una sola cuenta activa a la vez, con
switch-account entre ellas) **no hace falta** este patrón — basta con
reconectar el socket existente con el nuevo token después de un
`switch-account` exitoso (ver
[Cambiar de cuenta activa](#5-cambiar-de-cuenta-activa-switch-account)).

Intentar unirse a `calendar:<account_id>` de una cuenta a la que el
token conectado NO pertenece devuelve `{error: {reason: "forbidden"}}`
en el `receive("error", ...)` del `join` — igual que el `403
account_mismatch` de las rutas REST con `:account_id` en la URL.

---

## Manejo de Errores

### Formato de Error

El formato no es único en toda la API: conviven dos formatos, y cuál recibe una request depende de qué
parte del backend la rechaza.

**Sobre (spec [#1](https://github.com/ChordanDev/myfood-monorepo/issues/1)).** El status HTTP se deriva
del código:

```json
{
  "error": {
    "code": "unauthenticated",
    "message": "Authentication is required for this request."
  }
}
```

Lo devuelven:

- el pipeline de autenticación delante de todas las rutas REST protegidas: `401 unauthenticated` (token
  ausente, inválido o de un tipo incorrecto), `401 access_token_expired` y `401 account_not_found` (la
  sesión no tiene una membership activa);
- el control de acceso delante de las rutas que requieren acceso vigente, cuando la verificación de
  acceso está habilitada: `403 trial_expired`;
- las rutas de autenticación de la app móvil: `/api/auth/login/request-code`,
  `/api/auth/login/verify-code`, `/api/auth/signup/request-code`, `/api/auth/signup/verify-code`,
  `/api/auth/social` y `/api/auth/refresh`;
- `GET /api/me` y su alias `GET /api/auth/me`;
- `PUT /api/me/profile`: `422 validation_error` y `422 invalid_cooking_skill`;
- `GET` y `PUT /api/me/slot-cooking-times`, los tiempos de cocina por comida del usuario
  (`{ breakfast, lunch, dinner }`, cada uno con `cookingTimeMinutes` y `hungerLevel`):
  `404 slot_cooking_times_not_found` cuando el usuario todavía no guardó los tres slots,
  `422 validation_error` cuando el cuerpo no es válido y `422 invalid_hunger_level` cuando `hungerLevel`
  no es `light`, `normal` ni `strong`. El `message` de `validation_error` es
  `The field <field> is not valid.`, con el campo en camelCase (por ejemplo `lunch.cookingTimeMinutes` o
  `snack`), o `The request is not valid.` cuando el cuerpo no es un objeto JSON o ningún parser lo leyó.
  El `PUT` exige exactamente `breakfast`, `lunch` y `dinner`: `snack` no se requiere ni se acepta.
  `cookingTimeMinutes` es un entero de `0` a `240`, y `0` significa que el usuario no cocina en ese slot.
  El detalle está en las secciones 3.4 y 3.5 de
  [`frontend_integration_guide.md`](../frontend_integration_guide.md).

**Plano (anterior, no migrado al sobre).** El status lo elige cada endpoint:

```json
{
  "error": "not_found"
}
```

Lo siguen devolviendo:

- los errores de validación y de dominio que arman los controladores que no son de autenticación:
  contexto de cuenta, perfil dietario, planning, chat de planning, calendario, cooking, recetas, shopping,
  inventario, memberships, invitaciones, abandono de cuenta y billing;
- `/api/auth/switch-account`, para los errores que arma su propio controlador;
- la verificación de cuenta en `/api/accounts/:account_id/*`: `403` con `{ "error": "account_mismatch" }`.

Para errores que ningún controlador maneja (por ejemplo, una ruta inexistente), Phoenix responde con su
formato por defecto:

```json
{
  "errors": {
    "detail": "Not Found"
  }
}
```

### Códigos de Error Comunes

| Código | Significado | Acción Recomendada |
|--------|-------------|-------------------|
| `unauthenticated` | Token ausente o inválido | Refrescar token o re-login |
| `access_token_expired` | El access token expiró | Refrescar token y reintentar |
| `forbidden` | No tiene permisos | Verificar account_id |
| `account_mismatch` | El `:account_id` de la URL no coincide con la cuenta activa del token (multi-familia) | Hacer `switch-account` a la cuenta correcta primero, ver [Multi-Familia](#multi-familia-cuentas-múltiples) |
| `not_found` | Recurso no existe | Verificar IDs |
| `invalid_payload` | Datos inválidos | Validar input del usuario |
| `validation_error` | Un campo de la request no es válido; el `message` nombra el campo | Corregir ese campo |
| `meal_already_confirmed` | La comida pasada ya estaba cocinada o confirmada como no cocinada | Volver a leer el plan |
| `confirmation_window_closed` | La comida no es de los últimos 7 días | Usar una Cooking session para la comida de hoy |
| `not_owner` | Solo el `owner` de la cuenta puede hacer este cambio | Mostrar el valor sin permitir editarlo |
| `invalid_cooking_skill` | `cookingSkill` no está en el catálogo | Enviar `beginner`, `intermediate` o `advanced` |
| `slot_cooking_times_not_found` | El usuario todavía no guardó los tiempos de cocina por slot | Usar los valores por defecto y guardarlos con `PUT /api/me/slot-cooking-times` |
| `invalid_hunger_level` | `hungerLevel` no está en el catálogo | Enviar `light`, `normal` o `strong` |
| `generation_in_progress` | Ya hay una generación en curso | Esperar o cancelar |
| `no_active_generation` | No hay generación activa | Generar primero |
| `budget_exceeded` | Supera el presupuesto | Reducir constraints |
| `unreachable` | Servicio externo no disponible | Retry con backoff |

### Reconnection Strategy (ejemplo completo)

```javascript
class MyFoodSocket {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.maxReconnectAttempts = 10;
    this.reconnectAttempts = 0;
  }

  connect() {
    this.socket = new Socket(`${this.baseUrl}/socket`, {
      params: { token: this.token }
    });

    this.socket.onError(() => this.handleError());
    this.socket.onClose(() => this.handleClose());

    this.socket.connect();
  }

  handleError() {
    console.error("Socket connection error");
    // Notificar al usuario
    showErrorNotification("Conexión perdida. Reconectando...");
  }

  handleClose() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.calculateBackoff();
      console.log(`Reconnecting in ${delay}ms...`);

      setTimeout(() => {
        this.reconnectAttempts++;
        this.refreshToken().then(newToken => {
          this.token = newToken;
          this.connect();
        });
      }, delay);
    } else {
      showErrorNotification("No se pudo reconectar. Por favor re-login.");
    }
  }

  calculateBackoff() {
    const base = 1000;
    const maxDelay = 30000;
    const exponentialDelay = Math.min(
      base * Math.pow(2, this.reconnectAttempts),
      maxDelay
    );
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }

  async refreshToken() {
    // Llamar al endpoint de refresh
    const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    const { token } = await response.json();
    return token;
  }
}
```

---

## Tipos de Datos

### Dates

Formato ISO 8601: `YYYY-MM-DD`

```javascript
// Ejemplo
const date = "2026-06-10";
```

### Slots

Valores posibles: `breakfast`, `lunch`, `dinner`

```javascript
const SLOT_TYPES = ["breakfast", "lunch", "dinner"];
```

### Monedas

Siempre en **centavos** (enteros).

```javascript
// 15.00 USD = 1500 cents
const budgetCents = 1500;
```

### Macros de Recetas

```javascript
const macros = {
  protein_g: 25,      // gramos de proteína
  calories: 450,       // calorías
  carbs_g: 30         // gramos de carbohidratos
};
```

---

## Ejemplos de Código

### Login + Guardar Token

```javascript
async function postAuth(path, body) {
  const response = await fetch(`http://localhost:4000/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    // Los errores de auth usan el envelope `{ error: { code, message } }`;
    // un error de gateway puede no traer JSON.
    const errorBody = await response.json().catch(() => null);
    // "auth_request_failed" es un valor del cliente, no un código de la API.
    const failure = new Error(errorBody?.error?.code || "auth_request_failed");
    // En `429 rate_limited` la espera viaja en el header `retry-after` (segundos).
    failure.retryAfterSeconds = Number(response.headers.get("retry-after")) || null;
    throw failure;
  }

  return response.json();
}

// Paso 1: pedir el código que llega por email
function requestLoginCode(email) {
  return postAuth("login/request-code", { email });
}

// Paso 2: verificar el código y abrir la sesión
async function verifyLoginCode(email, code, deviceId) {
  const { accessToken, refreshToken, me } = await postAuth("login/verify-code", {
    email,
    code,
    deviceId
  });

  // Guardar tokens. AsyncStorage es solo ilustrativo: el refresh token
  // dura 30 días y en un dispositivo real va en almacenamiento seguro
  // (Keychain / Keystore).
  await AsyncStorage.setItem("auth_token", accessToken);
  await AsyncStorage.setItem("refresh_token", refreshToken);
  await AsyncStorage.setItem("user", JSON.stringify(me.user));

  return { accessToken, me };
}
```

### Obtener Calendario

```javascript
async function getCalendar(month) {
  const token = await AsyncStorage.getItem("auth_token");

  const response = await fetch(
    `http://localhost:4000/api/calendar?month=${month}`,
    {
      headers: { "Authorization": `Bearer ${token}` }
    }
  );

  return response.json();
}
```

### Generar Plan Semanal (con WebSocket)

```javascript
class PlanningService {
  constructor(socket) {
    this.channel = socket.channel("planning:1", {});
    this.listeners = {};
  }

  async generate(dateFrom, dateTo, request) {
    return new Promise((resolve, reject) => {
      // Escuchar respuesta
      this.channel.on("proposal_ready", payload => {
        resolve(payload);
      });

      this.channel.on("generation_error", payload => {
        reject(new Error(payload.reason));
      });

      // Unirse y abrir la sesión
      this.channel.join().receive("ok", () => {
        this.channel
          .push("start_planning", { rangeFrom: dateFrom, rangeTo: dateTo, request })
          .receive("ok", ({ sessionId }) => { this.sessionId = sessionId; });
      });
    });
  }

  // Confirmar es un request HTTP, no un comando del canal
  async confirm(proposalId) {
    const token = await AsyncStorage.getItem("auth_token");

    const response = await fetch("http://localhost:4000/api/planning/confirm", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ proposalId, sessionId: this.sessionId })
    });

    return response.json();
  }
}
```

### Uso en React Native

```javascript
import React, { useEffect, useState } from "react";
import { Socket } from "phoenix";

function App() {
  const [socket, setSocket] = useState(null);
  const [planning, setPlanning] = useState(null);

  useEffect(() => {
    const initSocket = async () => {
      const token = await AsyncStorage.getItem("auth_token");
      const s = new Socket("ws://localhost:4000/socket", {
        params: { token }
      });
      s.connect();
      setSocket(s);
    };

    initSocket();
  }, []);

  const handleGenerate = async () => {
    const service = new PlanningService(socket);
    const result = await service.generate(
      "2026-06-10",
      "2026-06-16",
      "algo liviano, sin pescado"
    );
    setPlanning(result);
  };

  return (
    <View>
      <Button title="Generar Plan" onPress={handleGenerate} />
    </View>
  );
}
```

---

## FAQ

### ¿El backend soporta offline?

El backend no maneja cache offline directamente. Se recomienda:
- Usar AsyncStorage para cache local
- Implementar SyncManager para reconectar y sincronizar
- Guardar operaciones pendientes y reintentarlas cuando haya conexión

### ¿Cómo manejo tokens expirados?

1. Capturar el error `401 access_token_expired`
2. Llamar a `POST /api/auth/refresh` con el `refreshToken` y guardar el par nuevo. Una sola llamada
   a la vez: si varios requests vencen juntos, todos esperan el mismo refresh (un segundo envío del
   mismo token revoca las sesiones del dispositivo)
3. Reconectar socket con nuevo token
4. Reintentar operación

Si el refresh responde `401`, la sesión terminó: volver a iniciar sesión con un código.

### ¿Qué pasa si el optimizador no encuentra solución?

El backend devuelve `no_valid_plan`. Opciones:
- Relajar constraints (menos proteína, más presupuesto)
- Excluir ingredientes problemáticos
- Reducir días de planificación

### ¿Puedo usar el mismo WebSocket para múltiples canales?

Sí, un solo socket puede conectarse a múltiples canales:

```javascript
const socket = new Socket("/socket", { params: { token } });
socket.connect();

const calendarChannel = socket.channel("calendar:1", {});
const planningChannel = socket.channel("planning:1", {});
const aiChannel = socket.channel("ai_chat:session123", {});
```

### ¿Los canales se desconectan solos?

Phoenix Channels manejan heartbeats automáticamente. Si hay desconexión:
1. El evento `onClose` se dispara
2. Implementar reconnection con exponential backoff (ver ejemplo arriba)
3. Resubscribe a los canales necesarios

---

## Checklist de Integración

- [ ] Configurar URL base del backend
- [ ] Implementar login con JWT
- [ ] Guardar token en storage seguro
- [ ] Incluir Authorization header en todas las requests
- [ ] Conectar WebSocket con token
- [ ] Implementar reconnection strategy
- [ ] Manejar errores según tabla de códigos
- [ ] Probar flow completo: login → calendario → generar plan → confirmar

---

## Contacto

Para dudas técnicas, contactar al equipo de backend:
- **Email:** backend@myfood.com
- **Slack:** #team-backend

**Versión del API:** 2026-07-11
**Última actualización:** 2026-07-11