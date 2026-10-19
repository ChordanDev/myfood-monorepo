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
- The monorepo API at `apps/api` with PostgreSQL available.
- A Python with the optimizer requirements (`apps/api/optimizer/requirements.txt`). OR-Tools 9.12
  has no wheels for Python 3.14, so use Python 3.13 or older, for example a `uv venv --python 3.12`.

## Run

Use the same deterministic credentials for backend setup and the Maestro flow. Do not commit
their values.

The backend is `apps/api` in its `e2e` environment (`config/e2e.exs`, database
`meal_planner_api_e2e`). It accepts two test doubles that every other environment refuses:
`AI_CLIENT=mock`, so no Gemini key is needed, and a fixed login code, so a code requested for
`E2E_LOGIN_EMAIL` is always `E2E_LOGIN_CODE`. Any other email gets a random code, as in `dev`.

```bash
# Terminal 1: backend setup and local E2E API, from the repository root
cd apps/api
export MIX_ENV=e2e
export AI_CLIENT=mock
export E2E_LOGIN_EMAIL='e2e-user@example.test'
export E2E_LOGIN_CODE='123456'
# Required by the restoration tracer; without it the access token lives 1 hour.
export E2E_ACCESS_TOKEN_TTL_SECONDS=2
# Planning proposals come from the OR-Tools optimizer: point at a Python that has it.
export OPTIMIZER_PYTHON=/path/to/venv/bin/python
mix deps.get
mix ecto.create && mix ecto.migrate
mix run priv/repo/e2e_seeds.exs
PORT=4000 mix phx.server
```

`priv/repo/e2e_seeds.exs` creates the Account, the User of `E2E_LOGIN_EMAIL` with onboarding
completed, and one catalog Recipe per Meal slot. Running it again leaves the same data: it also
deletes what the flows left behind (Planning sessions, Scheduled meals, the Shopping list, the
Cart and the Inventory of the Account, and the login codes of the email). It keeps the device
sessions, so the app stays signed in. Stop the API before running it again, or restart the API
after: a running Planning session keeps its state in memory.

`E2E_LOGIN_EMAIL` is exempt from the 60-second resend cooldown and the hourly code request
limits in `e2e`, so the flows can sign in one after another. Every other email keeps them.

The first start after creating the Python environment can time out the optimizer handshake while
Python compiles OR-Tools. Run `"$OPTIMIZER_PYTHON" -c 'import ortools.linear_solver.pywraplp'`
once beforehand, or restart the API if Planning answers `optimizer_unavailable`.

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
cd apps/api
MIX_ENV=e2e mix ecto.drop --force
```
