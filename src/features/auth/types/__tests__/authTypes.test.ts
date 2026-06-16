import type { AuthAccount, AuthMembership, AuthSession } from '../auth';

/**
 * Type-level contract test: the literal unions on the `auth.ts` types
 * are CLOSED — every value the back can emit must be in the union, and
 * any other value must be rejected at compile time.
 *
 * Source of truth for each union (back-side, read-only):
 *
 *   - `account.type`           -> `MyFoodBack.Accounts.Account.changeset/2`
 *                                 validate_inclusion(:type, [...])
 *   - `account.subscription_status`
 *                              -> `MyFoodBack.Accounts.Account.changeset/2`
 *                                 validate_inclusion(:subscription_status, [...])
 *   - `membership.role`        -> `MyFoodBack.Accounts.Membership.changeset/2`
 *                                 validate_inclusion(:role, [...])
 *   - `token_type`             -> `MyFoodBack.Auth.auth_response/6` and
 *                                 `token_response/3` (hard-coded `"Bearer"`)
 *
 * If a `@ts-expect-error` below stops firing, the union has been
 * widened or the back's value set changed. The fix is to either
 * re-tighten the union in `auth.ts` or to add a new legitimate value
 * to the union AND its companion back-side changeset validator.
 */

describe('auth literal unions are closed', () => {
  it('rejects unknown AuthAccount.type values', () => {
    // @ts-expect-error — closed union should reject unknown type values
    const invalidType: AuthAccount['type'] = 'unknown_value_xyz';
    // Touch the value so the const is "used" from TS's perspective.
    void invalidType;
  });

  it('rejects unknown AuthAccount.subscriptionStatus values', () => {
    // @ts-expect-error — closed union should reject unknown subscription status values
    const invalidStatus: AuthAccount['subscriptionStatus'] = 'unknown_value_xyz';
    void invalidStatus;
  });

  it('rejects unknown AuthMembership.role values', () => {
    // @ts-expect-error — closed union should reject unknown role values
    const invalidRole: AuthMembership['role'] = 'unknown_value_xyz';
    void invalidRole;
  });

  it('rejects unknown AuthSession.tokenType values', () => {
    // @ts-expect-error — closed union should reject unknown token type values
    const invalidTokenType: AuthSession['tokenType'] = 'unknown_value_xyz';
    void invalidTokenType;
  });
});
