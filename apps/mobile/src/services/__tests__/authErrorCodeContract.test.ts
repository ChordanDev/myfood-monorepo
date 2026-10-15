/// <reference types="node" />
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AUTH_ERROR_MESSAGES, errorFromEnvelope, KNOWN_AUTH_ERROR_CODES } from '@/api/errors';

/**
 * Contract test: every error code emitted by the api via the
 * `error(:atom)` envelope helper MUST be present in the mobile app's
 * `KNOWN_AUTH_ERROR_CODES` allowlist. Otherwise `errorFromEnvelope` on
 * the mobile side normalizes the code to `unknown_error` and the user sees
 * a generic "Request failed" message instead of a domain-specific one.
 *
 * The allowlist and the message map are imported from `@/api/errors`,
 * the module the app reads at runtime, so removing a code there fails
 * this test. That module only has a type import, so importing it runs
 * no side effects.
 *
 * The api source is treated as a read-only fixture. We walk every
 * `.ex` file under `apps/api/lib/` and collect atoms from `error(:atom)`
 * calls — these are the codes the api renders through
 * `MealPlannerApiWeb.ApiError.error/2`.
 */
describe('auth error code contract (api -> mobile allowlist)', () => {
  // Controllers and plugs in `apps/api` render the mobile error envelope
  // with `conn |> ApiError.error(:atom)`. The atom is the `error.code`
  // that goes out on the wire, so the atoms in those calls are exactly
  // the codes the envelope can carry.
  //
  // The scan does NOT see:
  //   * `ApiError.server_fault/1` (`unknown_error`) — it has no
  //     `error(:atom)` literal by design, and `unknown_error` is in the
  //     allowlist anyway.
  //   * `ApiError.validation_error/2` (`validation_error`) — it renders
  //     the code with a message naming the offending field, without an
  //     `error(:atom)` literal. The scan still collects the code, from
  //     the rejection that names no field and goes through
  //     `error(:validation_error)`.
  //   * The flat `{ "error": "<reason>" }` bodies that invite accept,
  //     switch-account and the controllers outside auth build with
  //     `json/2` — they are not part of the envelope contract.
  //   * `MealPlannerApiWeb.ErrorJSON` (`{ "errors": { "detail" } }`) —
  //     Phoenix's transport-level fallback.
  // The contract asserted here is: every `error(:atom)` call in the api
  // has a mobile-side allowlist entry, full stop.

  /**
   * Resolve the api source `lib/` directory inside the monorepo.
   *
   * This test lives at `apps/mobile/src/services/__tests__/`, so four
   * `..` up from here lands at `apps/`, and the api lives at
   * `apps/api/lib`. The `appsRoot` parameter exists so the resolver can
   * be pointed at a synthetic root in tests.
   *
   * Returns `null` when the directory does not exist, so callers can
   * decide whether to skip or fail the contract test.
   */
  function resolveApiLibPath(
    appsRoot: string = path.resolve(__dirname, '..', '..', '..', '..')
  ): string | null {
    const candidate = path.join(appsRoot, 'api', 'lib');
    return fs.existsSync(candidate) ? candidate : null;
  }

  function extractApiErrorAtoms(apiLib: string): string[] {
    if (!fs.existsSync(apiLib)) {
      throw new Error(
        `Api source not found at ${apiLib}. ` +
          'This test depends on the monorepo layout (apps/api next to apps/mobile).'
      );
    }

    const atoms = new Set<string>();
    const re = /error\(:([a-z_]+)\)/g;

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && full.endsWith('.ex')) {
          const source = fs.readFileSync(full, 'utf8');
          for (const match of source.matchAll(re)) {
            atoms.add(match[1]);
          }
        }
      }
    }

    walk(apiLib);
    return [...atoms].sort();
  }

  // The allowlist is a `Set<AuthErrorCode>`; the codes scanned from the
  // api and parsed from the union source are plain strings, so read it
  // through a string-typed view instead of casting at every call site.
  const runtimeAllowlist: ReadonlySet<string> = KNOWN_AUTH_ERROR_CODES;

  // `AuthErrorCode` is a type-only union: it is erased at compile time
  // and has no runtime value to import, so its members are parsed from
  // the source text. The file path is resolved relative to this test,
  // so it moves with the test directory.
  const authTypesPath = path.resolve(__dirname, '..', '..', 'features', 'auth', 'types', 'auth.ts');
  const authTypesSource = fs.readFileSync(authTypesPath, 'utf8');

  /**
   * Extract the single-quoted string-literal members of the
   * `AuthErrorCode` union from the auth types source. We anchor on
   * the `export type AuthErrorCode =` declaration and scan every
   * `'foo_bar'` literal up to the closing `;`. The regex is
   * intentionally narrow: single-quoted, lowercase + underscore
   * — the same shape we use everywhere else in the contract.
   *
   * Exposed as a parameterised parser so the test can triangulate
   * against synthetic source — we need to prove the parser actually
   * surfaces a missing member (otherwise the test could pass
   * trivially by parsing nothing).
   */
  function extractAuthErrorCodeUnionMembersFrom(source: string): string[] {
    const unionMatch = source.match(/export type AuthErrorCode\s*=\s*([\s\S]*?);/);
    expect(unionMatch).not.toBeNull();
    const body = unionMatch![1];
    return (body.match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
  }

  function extractAuthErrorCodeUnionMembers(): string[] {
    return extractAuthErrorCodeUnionMembersFrom(authTypesSource);
  }

  function readMaxPlanningDays(): number {
    const apiLib = resolveApiLibPath();
    if (!apiLib) {
      throw new Error(
        '[authErrorCodeContract] apps/api/lib not found next to apps/mobile. ' +
          'This test depends on the monorepo layout.'
      );
    }
    const servicePath = path.join(apiLib, 'meal_planner_api', 'services', 'planning_service.ex');
    const match = fs.readFileSync(servicePath, 'utf8').match(/^\s*@max_planning_days (\d+)$/m);
    expect(match).not.toBeNull();
    return Number(match![1]);
  }

  function scanApiErrorCodes(): string[] {
    const apiLib = resolveApiLibPath();
    if (!apiLib) {
      throw new Error(
        '[authErrorCodeContract] apps/api/lib not found next to apps/mobile. ' +
          'This test depends on the monorepo layout.'
      );
    }
    const apiCodes = extractApiErrorAtoms(apiLib);

    // Sanity check: the extractor must actually have found something.
    // If this ever goes to zero, the test is silently lying.
    expect(apiCodes.length).toBeGreaterThan(0);
    return apiCodes;
  }

  it('resolveApiLibPath() resolves apps/api/lib inside the monorepo', () => {
    const resolved = resolveApiLibPath();
    expect(typeof resolved).toBe('string');
    expect(resolved).not.toBeNull();
    expect(resolved!.endsWith(path.join('apps', 'api', 'lib'))).toBe(true);
  });

  it('resolveApiLibPath() returns null when apps/api is not present', () => {
    // Triangulation: the helper must return `null` when the root
    // directory has no `api/lib`. We point the lookup at a tmpdir to
    // simulate the missing case.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-api-'));
    try {
      const resolved = resolveApiLibPath(tmpRoot);
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // Scans the real `apps/api/lib` tree. The api keeps every envelope
  // call in the piped `conn |> ApiError.error(:atom)` shape so this scan
  // can see it (see the `ApiError` moduledoc).
  it('every error code emitted by the api is in the mobile allowlist', () => {
    const missing = scanApiErrorCodes().filter((code) => !runtimeAllowlist.has(code));
    expect(missing).toEqual([]);
  });

  it('errorFromEnvelope() keeps every error code emitted by the api', () => {
    // Behavioural anchor: this is the normalizer every api error goes
    // through, so it proves the allowlist asserted above is the one the
    // app applies, not just an exported value.
    const normalized = scanApiErrorCodes().filter(
      (code) => errorFromEnvelope({ error: { code, message: 'x' } }, 400).code !== code
    );
    expect(normalized).toEqual([]);
  });

  it('errorFromEnvelope() keeps validation_error and the message naming the field', () => {
    // The scan collects this code from a rejection that names no field.
    // The answers that name one come from a renderer the scan cannot
    // see, so the code is pinned here as well.
    const message = 'The field householdSize is not valid.';

    expect(errorFromEnvelope({ error: { code: 'validation_error', message } }, 422)).toMatchObject({
      code: 'validation_error',
      message,
      status: 422,
    });
  });

  it('errorFromEnvelope() normalizes a code outside the allowlist to unknown_error', () => {
    // Triangulation: the check above would pass trivially if the
    // normalizer echoed back any code it was given.
    expect(runtimeAllowlist.has('brand_new_code')).toBe(false);
    expect(errorFromEnvelope({ error: { code: 'brand_new_code', message: 'x' } }, 400).code).toBe(
      'unknown_error'
    );
  });

  it('errorFromEnvelope() keeps the codes of a range that is too long and their maxDays', () => {
    // Issue #213: the api renders these two with `ApiError.envelope/2`, not
    // `error(:atom)`, so the scan above does not see them.
    for (const code of ['date_range_too_long', 'planning_date_range_too_long'] as const) {
      const error = errorFromEnvelope(
        { error: { code, message: 'x', details: { maxDays: 7 } } },
        422
      );

      expect(error.code).toBe(code);
      expect(error.details).toEqual({ maxDays: 7 });
    }
  });

  it('the copies of the range codes name the most days a User plans, as the api has it', () => {
    // The api keeps that maximum in `PlanningService` (`@max_planning_days`)
    // and sends it as `details.maxDays`; the copies spell the number out.
    const maxDays = readMaxPlanningDays();

    expect(AUTH_ERROR_MESSAGES.date_range_too_long).toBe(
      `Elegí un rango de hasta ${maxDays} días.`
    );
    expect(AUTH_ERROR_MESSAGES.planning_date_range_too_long).toBe(
      `Elegí un rango de hasta ${maxDays} días.`
    );
    expect(AUTH_ERROR_MESSAGES.planning_invalid_range).toBe(
      `Elegí entre 1 y ${maxDays} días, empezando hoy o más adelante.`
    );
  });

  it('does not know rate_limit_record_failed, a code the api never emits', () => {
    // The api records a rate-limit event with `:ok = insert_event(...)`,
    // so a failed record raises instead of answering a code. The catalog
    // used to carry this one.
    const code = 'rate_limit_record_failed';

    expect(scanApiErrorCodes()).not.toContain(code);
    expect(extractAuthErrorCodeUnionMembers()).not.toContain(code);
    expect(runtimeAllowlist.has(code)).toBe(false);
    expect(Object.keys(AUTH_ERROR_MESSAGES)).not.toContain(code);
    expect(errorFromEnvelope({ error: { code, message: 'x' } }, 500).code).toBe('unknown_error');
  });

  it('AUTH_ERROR_MESSAGES has an entry for every code in KNOWN_AUTH_ERROR_CODES', () => {
    // A code in the allowlist without a Spanish message would render
    // as the raw `error.message` from the api (often English) — i.e.
    // a regression. Lock the 1:1 coverage in.
    const messageKeys = new Set(Object.keys(AUTH_ERROR_MESSAGES));
    const missing = [...runtimeAllowlist].filter((code) => !messageKeys.has(code)).sort();
    expect(missing).toEqual([]);
  });

  it('every member of the AuthErrorCode union has an allowlist entry', () => {
    // The contract runs the OTHER direction: if someone adds a code
    // to the `AuthErrorCode` union in `src/features/auth/types/auth.ts`
    // and forgets to add it to `KNOWN_AUTH_ERROR_CODES`, the runtime
    // normalizer (`errorFromEnvelope`) would coerce it to
    // `unknown_error` and the user would see a generic "Request
    // failed" message. Lock the union ⊆ allowlist direction in; the
    // opposite one is enforced by tsc through `Set<AuthErrorCode>`.
    const unionMembers = extractAuthErrorCodeUnionMembers();
    expect(unionMembers.length).toBeGreaterThan(0);

    const missing = unionMembers.filter((code) => !runtimeAllowlist.has(code)).sort();
    expect(missing).toEqual([]);
  });

  it('extractAuthErrorCodeUnionMembersFrom() surfaces a new code against a synthetic union', () => {
    // Triangulation: prove the parser actually walks the union body
    // and returns the new member. If the regex is too narrow (e.g.
    // anchored on the wrong shape), this would return [] and the
    // allowlist check would pass trivially.
    const synthetic = [
      'export type AuthErrorCode =',
      "  | 'a'",
      "  | 'b'",
      "  | 'brand_new_code';",
    ].join('\n');
    expect(extractAuthErrorCodeUnionMembersFrom(synthetic)).toEqual(['a', 'b', 'brand_new_code']);
  });
});
