# Local iOS Maestro flows

These flows run the app on an iOS simulator against the local `apps/api` `e2e` environment.
They cover the journeys that block a User when they break; rules stay in Jest and ExUnit.

| Flow (`e2e/maestro/`)            | Journey                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `login-verification.yaml`        | Requests a code, verifies it, and reaches Home as the seeded User.                                          |
| `authenticated-restoration.yaml` | After the access token expired, a cold relaunch restores the session and reaches Home.                      |
| `planning-confirm.yaml`          | Signs in, starts a Planning session, gets a proposal, confirms it, and sees today's Scheduled meal on Home. |
| `shopping-check-off.yaml`        | Signs in, opens the Shopping list of the confirmed plan, and checks one item off.                           |

The authentication flows use the normal request-code, verify-code and refresh-token paths. No
authentication bypass is involved: the API only issues a known code for one email in `e2e`.

## Prerequisites

- macOS with Xcode and an iOS simulator.
- Node dependencies installed with `npm ci` in `apps/mobile`.
- Maestro CLI installed with `curl -Ls https://get.maestro.mobile.dev | bash`.
- Java 17+ from macOS `java_home` or the Homebrew `openjdk@17` formula.
- The monorepo API at `apps/api` with PostgreSQL available.
- A Python with the optimizer requirements (`apps/api/optimizer/requirements.txt`, which pins
  OR-Tools 9.15). CI runs it on Python 3.12, for example a `uv venv --python 3.12`.

## Run

Use the same deterministic credentials for backend setup and the Maestro flow. Do not commit
their values.

The backend is `apps/api` in its `e2e` environment (`config/e2e.exs`, database
`meal_planner_api_e2e`). It accepts two test doubles that every other environment refuses:
`AI_CLIENT=mock`, so no Gemini key is needed, and a fixed login code, so a code requested for
`E2E_LOGIN_EMAIL` is always `E2E_LOGIN_CODE`. Any other email gets a random code, as in `dev`.

The `e2e` database is `meal_planner_api_e2e`, or the name in `MYFOOD_E2E_DATABASE`. It never
reads the `DB_NAME` of `dev`, and `config/e2e.exs` refuses a name that does not end in `_e2e`, so
every `MIX_ENV=e2e` command fails before it connects. The seed and the cleanup below can only reach
a database named for `e2e`.

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
# Terminal 2: install and launch the local simulator build, from the repository root
cd apps/mobile
npm ci
npm run ios:e2e
```

`ios:e2e` creates or updates the local iOS development build with bundle identifier
`com.myfood.e2e`, pointed at `http://127.0.0.1:4000`. Keep Metro running while Maestro executes.
CocoaPods needs a UTF-8 locale: if `pod install` fails with `Unicode Normalization not
appropriate for ASCII-8BIT`, run it with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.

Every Maestro command shares one runner, `scripts/run-maestro-e2e-macos.sh`. It validates the major version returned by
`/usr/libexec/java_home -v 17`. If it is older than 17, the runner resolves Homebrew's
`openjdk@17` formula with `brew --prefix openjdk@17`. It fails clearly rather than allowing
Maestro to run on Java 11.

```bash
# Terminal 3: run the flows (with the exact values used in Terminal 1), from the repository root
cd apps/mobile
export E2E_LOGIN_EMAIL='e2e-user@example.test'
export E2E_LOGIN_CODE='123456'
npm run e2e:maestro -- all
```

The runner takes one mode:

| Command                         | Runs                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run e2e:maestro`           | `login-verification.yaml` only (the default mode, `login`).                                         |
| `npm run e2e:maestro:restore`   | Login, the expiry wait, then `authenticated-restoration.yaml`.                                      |
| `npm run e2e:maestro -- <flow>` | One flow of `e2e/maestro/` by file name, without `.yaml`: `planning-confirm`, `shopping-check-off`. |
| `npm run e2e:maestro -- all`    | The restore command, then `planning-confirm`, then `shopping-check-off`.                            |

The runner stops at the first flow that fails and exits non-zero. An unknown mode fails before
Maestro starts. `all` needs the API's `E2E_ACCESS_TOKEN_TTL_SECONDS=2` for its restoration step.

The app uses `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000`; on the iOS simulator this reaches the
host Phoenix server. The login flow clears the simulator Keychain (`clearState` alone keeps the
session SecureStore saved there) and app state, requests a real code, verifies it, dismisses
the native "Sesión iniciada" alert, then asserts the first authenticated state: Home, because the
seeded User has completed onboarding.

`shopping-check-off` checks off an item of the plan `planning-confirm` confirmed, so run
`planning-confirm` first (`all` does). After a run, run the seed again to start from an empty
plan; without it a second `planning-confirm` plans the days after the last planned one.

To run login plus expired-access restoration intentionally, use the separate command:

```bash
export E2E_LOGIN_EMAIL='e2e-user@example.test'
export E2E_LOGIN_CODE='123456'
npm run e2e:maestro:restore
```

The restoration command runs the existing login flow first. Only after its Home assertion
succeeds, the shell runner waits 4 seconds by default, then runs a second Maestro flow that stops
and launches the app with `clearState: false`. The second flow asserts Home after app boot;
with the backend access-token TTL set to 2 seconds, reaching that authenticated gate requires the
persisted refresh token to rotate and the original authenticated request to retry.

`E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS` optionally overrides the wait. It must be a base-10 integer
from 4 through 300; invalid values fail before Maestro starts. For example:

```bash
E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS=7 npm run e2e:maestro:restore
```

## Add a flow

1. Give every element the flow touches a `testID` with the `e2e-` prefix. Flows select by `id:`,
   never by visible copy, so a copy change does not break them. The native `Alert` of the login
   flow is the one exception: it has no `testID`.
2. Add `e2e/maestro/<flow>.yaml` with `appId: com.myfood.e2e`. Start with
   `- runFlow: login-verification.yaml` when the journey needs a signed-in User.
3. Add the flow name to `all_flows` in `scripts/run-maestro-e2e-macos.sh` if `all` should run it,
   in the order its data needs. `npm run e2e:maestro -- <flow>` runs it on its own either way.
4. Add the new `testID`s and the flow's selectors to
   `src/features/auth/__tests__/maestroSelectors.contract.test.ts`, so renaming one breaks Jest.
5. If the journey needs data, seed it in `apps/api/priv/repo/e2e_seeds.exs`, keeping the seed
   idempotent.

## Artifacts and cleanup

Maestro writes reports, screenshots, video, and command traces to `e2e/artifacts/maestro/`.
That directory is ignored. Backend cleanup remains manual; it drops the database named for `e2e` (the config refuses any
other name):

```bash
cd apps/api
MIX_ENV=e2e mix ecto.drop --force
```
