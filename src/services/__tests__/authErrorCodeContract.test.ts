import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Contract test: every error code emitted by the back via the
 * `error(:atom)` domain-error helper MUST be present in the front's
 * `KNOWN_AUTH_ERROR_CODES` allowlist. Otherwise `errorFromEnvelope` on
 * the front normalizes the code to `unknown_error` and the user sees a
 * generic "Request failed" message instead of a domain-specific one.
 *
 * The back source is treated as a read-only fixture. We walk every
 * `.ex` file under the back's `lib/` directory and collect atoms from
 * `error(:atom)` calls — these are the domain codes the Auth context
 * raises.
 */
describe('auth error code contract (back -> front allowlist)', () => {
  // The Auth domain context raises domain errors with `error(:atom)`.
  // The atoms that pass through `ErrorRendering.safe_error/1` and out
  // the wire as `error.code` are exactly the atoms in those calls.
  //
  // We do NOT include codes that come from:
  //   * `SafeError` (`internal_error`) — intentionally normalized.
  //   * `RequireUnlockedAccount` plug (`account_locked`) — billing/UX
  //     path handled outside the auth allowlist.
  //   * `ErrorJSON` (`request_too_large`) — transport-level.
  //   * `code: "..."` string literals in `accounts.ex` — those flow
  //     through a different path (see `KNOWN_AUTH_ERROR_CODES`).
  // The contract asserted here is: every `error(:atom)` raised by the
  // back has a front-side allowlist entry, full stop.

  /**
   * Resolve the back source `lib/` directory.
   *
   * Order of candidates (workspace-relative, four `..` up from this
   * test file lands at the monorepo root):
   *   1. `my_food_back/lib` — local dev (the developer's monorepo has
   *      the back checked out as a sibling named `my_food_back`).
   *   2. `progra-3-back/lib` — CI (`.github/workflows/ci.yml` clones
   *      the back to `../progra-3-back` as a sibling of the front
   *      checkout, so the path resolves to the CI workspace).
   *
   * Returns `null` when no candidate exists, so callers can decide
   * whether to skip or fail the contract test.
   */
  function resolveBackLibPath(
    root: string = path.resolve(__dirname, '..', '..', '..', '..')
  ): string | null {
    const candidates = [
      path.join(root, 'my_food_back', 'lib'),
      path.join(root, 'progra-3-back', 'lib'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function extractBackErrorAtoms(backLib: string): string[] {
    if (!fs.existsSync(backLib)) {
      throw new Error(
        `Back source not found at ${backLib}. ` +
          'This test depends on a sibling back repo at the monorepo root.'
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

    walk(backLib);
    return [...atoms].sort();
  }

  // Importing the production module would also re-run the back-end of
  // the auth service. Use a small local mirror of the allowlist to keep
  // this contract test self-contained and explicit. If this mirror
  // drifts from the real one, the front would already be broken for
  // other reasons — and the next two tests will still verify the real
  // front's allowlist against the back.
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

  // Read the real allowlist + message map straight from the front
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

  it('resolveBackLibPath() returns a non-null string when a sibling back exists', () => {
    // The contract test depends on a sibling back checkout. The
    // helper must resolve at least one candidate when the back is
    // present (local dev with `my_food_back` or CI with
    // `progra-3-back`).
    const resolved = resolveBackLibPath();
    expect(typeof resolved).toBe('string');
    expect(resolved).not.toBeNull();
  });

  it('resolveBackLibPath() returns null when no sibling back is present', () => {
    // Triangulation: the helper must return `null` when the root
    // directory has neither `my_food_back` nor `progra-3-back`.
    // We point the lookup at a tmpdir to simulate the missing case.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-back-'));
    try {
      const resolved = resolveBackLibPath(tmpRoot);
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('every error code emitted by the back is in the front allowlist', () => {
    const backLib = resolveBackLibPath();
    if (!backLib) {
      // Skip with a clear message — the dynamic assertion requires
      // a sibling checkout. CI sets this up via `.github/workflows/
      // ci.yml` (clones the back to `../progra-3-back`); local devs
      // need `my_food_back` next to this repo. If we land here,
      // someone forgot one of those setups.
      console.warn(
        '[authErrorCodeContract] Back source not found as a sibling. ' +
          'Expected `my_food_back/lib` (local) or `progra-3-back/lib` (CI) at the monorepo root. ' +
          'Skipping dynamic back -> front contract assertion.'
      );
      pending(
        'Back source not found. Clone the back as a sibling ' +
          '(my_food_back locally, or progra-3-back in CI) to enable this test.'
      );
      return;
    }
    const backCodes = extractBackErrorAtoms(backLib);

    // Sanity check: the extractor must actually have found something.
    // If this ever goes to zero, the test is silently lying.
    expect(backCodes.length).toBeGreaterThan(0);

    const missing = backCodes.filter((code) => !KNOWN_AUTH_ERROR_CODES.has(code));
    expect(missing).toEqual([]);
  });

  it('KNOWN_AUTH_ERROR_CODES in the front allowlist matches the production source', () => {
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
    // as the raw `error.message` from the back (often English) — i.e.
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
