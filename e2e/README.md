# Local iOS Maestro auth tracers

These tracers exercise the normal authentication paths against the local Phoenix `e2e`
environment. The login-only command verifies request-code and verify-code. The restoration
command reuses that flow, waits for its short-lived access token to expire, cold-relaunches the
installed app without clearing SecureStore, and verifies onboarding returns through the existing
refresh-token rotation and request retry path. No authentication bypass is involved.

## Prerequisites

- macOS with Xcode and an iOS simulator.
- Node dependencies installed with `npm ci`.
- Maestro CLI installed with `curl -Ls https://get.maestro.mobile.dev | bash`.
- Java 17+ from macOS `java_home` or the Homebrew `openjdk@17` formula.
- The sibling backend at `../my_food_back` with PostgreSQL available.

## Run

Use the same deterministic credentials for backend setup and the Maestro flow. Do not commit
their values.

```bash
# Terminal 1: backend setup and local E2E API
cd ../my_food_back
export MIX_ENV=e2e
export E2E_LOGIN_EMAIL='e2e-user@example.test'
export E2E_LOGIN_CODE='123456'
# Required by the restoration tracer; the e2e default otherwise remains 900 seconds.
export E2E_ACCESS_TOKEN_TTL_SECONDS=2
mix ecto.setup
PORT=4000 mix phx.server
```

Run `mix ecto.setup` once, before login. Do not run it between login and the restoration relaunch:
setup clears the refresh session that the second half must rotate.

```bash
# Terminal 2: install and launch the local simulator build
cd ../my-expo-app
npm ci
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npm run ios:e2e
```

`ios:e2e` creates or updates the local iOS development build with bundle identifier
`com.myfood.e2e`. Keep Metro running while Maestro executes.

Both Maestro commands share one runner. It validates the major version returned by
`/usr/libexec/java_home -v 17`. If it is older than 17, the runner resolves Homebrew's
`openjdk@17` formula with `brew --prefix openjdk@17`. It fails clearly rather than allowing
Maestro to run on Java 11.

```bash
# Terminal 3: run the tracer (with the exact values used in Terminal 1)
cd ../my-expo-app
export E2E_LOGIN_EMAIL='e2e-user@example.test'
export E2E_LOGIN_CODE='123456'
npm run e2e:maestro
```

The app uses `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000`; on the iOS simulator this reaches the
host Phoenix server. The flow clears app state, requests a real code, verifies it, then asserts
the first authenticated state: the incomplete user's onboarding screen.

To run login plus expired-access restoration intentionally, use the separate command:

```bash
export E2E_LOGIN_EMAIL='e2e-user@example.test'
export E2E_LOGIN_CODE='123456'
npm run e2e:maestro:restore
```

The restoration command runs the existing login flow first. Only after its onboarding assertion
succeeds, the shell runner waits 4 seconds by default, then runs a second Maestro flow that stops
and launches the app with `clearState: false`. The second flow asserts onboarding after app boot;
with the backend access-token TTL set to 2 seconds, reaching that authenticated gate requires the
persisted refresh token to rotate and the original authenticated request to retry.

`E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS` optionally overrides the wait. It must be a base-10 integer
from 4 through 300; invalid values fail before Maestro starts. For example:

```bash
E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS=7 npm run e2e:maestro:restore
```

Maestro writes reports, screenshots, video, and command traces to `e2e/artifacts/maestro/`.
That directory is ignored. Backend cleanup remains manual:

```bash
cd ../my_food_back
MIX_ENV=e2e POSTGRES_E2E_DB=my_food_back_e2e mix ecto.drop --force
```
