/// <reference types="node" />
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Contract test: every error code emitted by the api via the
 * `error(:atom)` envelope helper MUST be present in the mobile app's
 * `KNOWN_AUTH_ERROR_CODES` allowlist. Otherwise `errorFromEnvelope` on
 * the mobile side normalizes the code to `unknown_error` and the user sees
 * a generic "Request failed" message instead of a domain-specific one.
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
  //   * The flat `{ "error": "<reason>" }` bodies the legacy and
  //     non-auth controllers still build with `json/2` — they are not
  //     part of the envelope contract.
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

  // Importing the production module would also re-run the back-end of
  // the auth service. Use a small local mirror of the allowlist to keep
  // this contract test self-contained and explicit. If this mirror
  // drifts from the real one, the mobile app would already be broken for
  // other reasons — and the next two tests will still verify the real
  // mobile allowlist against the api.
  const KNOWN_AUTH_ERROR_CODES = new Set([
    'invalid_email',
    'email_already_exists',
    'email_not_found',
    'rate_limited',
    'code_invalid',
    'code_expired',
    'code_send_failed',
    'too_many_attempts',
    'unauthenticated',
    'access_token_expired',
    'refresh_token_invalid',
    'refresh_token_revoked',
    'refresh_token_replayed',
    'refresh_token_expired',
    'refresh_token_session_mismatch',
    'account_not_found',
    'rate_limit_record_failed',
    'trial_expired',
    'onboarding_invalid',
    'onboarding_already_complete',
    'preferences_invalid',
    'slot_cooking_times_invalid',
    'configuration_error',
    'network_error',
    'timeout',
    'unknown_error',
  ]);

  // Read the real allowlist + message map straight from the mobile
  // source so the assertions are anchored to the shipping code, not a
  // duplicated copy.
  const frontServicePath = path.resolve(__dirname, '..', 'authService.ts');
  const frontSource = fs.readFileSync(frontServicePath, 'utf8');

  // Read the `AuthErrorCode` type from the auth types module. We
  // anchor on the source file rather than importing the type because
  // importing would pull the whole auth module graph and run side
  // effects. The file path is resolved relative to this test, so it
  // moves with the test directory.
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

  /** Extract the single-quoted code keys from `new Set<AuthErrorCode>([...])`. */
  function extractProductionAllowlistKeys(): string[] {
    const setMatch = frontSource.match(
      /const KNOWN_AUTH_ERROR_CODES\s*=\s*new Set<AuthErrorCode>\(\[([\s\S]*?)\]\)/
    );
    expect(setMatch).not.toBeNull();
    return (setMatch![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
  }

  /** Extract the message keys (top-level `foo:`) from the AUTH_ERROR_MESSAGES object literal. */
  function extractProductionMessageKeys(): string[] {
    // Match the first top-level `{` after the `=` and the matching `}`;
    // we approximate matching with a non-greedy scan up to the first
    // `};\n` outside a string, which is the object's terminator.
    const messagesMatch = frontSource.match(
      /const AUTH_ERROR_MESSAGES:\s*Partial<Record<AuthErrorCode,\s*string>>\s*=\s*\{([\s\S]*?)\n\};/
    );
    expect(messagesMatch).not.toBeNull();
    return (messagesMatch![1].match(/^\s*([a-z_]+):/gm) ?? []).map((line) =>
      line.replace(/^\s*([a-z_]+):.*$/, '$1')
    );
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

    const missing = apiCodes.filter((code) => !KNOWN_AUTH_ERROR_CODES.has(code));
    expect(missing).toEqual([]);
  });

  it('KNOWN_AUTH_ERROR_CODES in the mobile allowlist matches the production source', () => {
    // The mirror above must stay in lockstep with the real
    // KNOWN_AUTH_ERROR_CODES set in src/services/authService.ts. This
    // is a guard against a silent divergence between this test's
    // fixture and the real shipping code.
    const listed = extractProductionAllowlistKeys();
    const mirrorList = [...KNOWN_AUTH_ERROR_CODES].sort();

    expect(listed.sort()).toEqual(mirrorList);
  });

  it('AUTH_ERROR_MESSAGES has an entry for every code in KNOWN_AUTH_ERROR_CODES', () => {
    // A code in the allowlist without a Spanish message would render
    // as the raw `error.message` from the api (often English) — i.e.
    // a regression. Lock the 1:1 coverage in.
    const messageKeys = extractProductionMessageKeys();
    const missing = [...KNOWN_AUTH_ERROR_CODES]
      .filter((code) => !messageKeys.includes(code))
      .sort();
    expect(missing).toEqual([]);
  });

  it('every member of the AuthErrorCode union has an allowlist entry', () => {
    // The contract runs the OTHER direction: if someone adds a code
    // to the `AuthErrorCode` union in `src/features/auth/types/auth.ts`
    // and forgets to add it to `KNOWN_AUTH_ERROR_CODES`, the runtime
    // normalizer (`errorFromEnvelope`) would coerce it to
    // `unknown_error` and the user would see a generic "Request
    // failed" message. Lock the union ⊇ allowlist direction in.
    const unionMembers = extractAuthErrorCodeUnionMembers();
    expect(unionMembers.length).toBeGreaterThan(0);

    const missing = unionMembers.filter((code) => !KNOWN_AUTH_ERROR_CODES.has(code)).sort();
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
