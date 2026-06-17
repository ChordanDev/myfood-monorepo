import { isUuidV4, newRequestId } from '../requestId';

const UUID_A = '123e4567-e89b-42d3-a456-426614174000';
const UUID_B = '987e6543-e21b-42d3-b456-426614174999';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('requestId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('returns the UUID v4 produced by crypto.randomUUID', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: jest.fn(() => UUID_A) },
    });

    expect(newRequestId()).toBe(UUID_A);
    expect(isUuidV4(newRequestId())).toBe(true);
  });

  it('generates a fresh UUID v4 for each call', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: jest.fn().mockReturnValueOnce(UUID_A).mockReturnValueOnce(UUID_B) },
    });

    const first = newRequestId();
    const second = newRequestId();

    expect(first).toBe(UUID_A);
    expect(second).toBe(UUID_B);
    expect(first).not.toBe(second);
    expect(isUuidV4(first)).toBe(true);
    expect(isUuidV4(second)).toBe(true);
  });

  it('rejects non-v4 UUIDs and control-character strings', () => {
    expect(isUuidV4('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(isUuidV4(`${UUID_A}\n`)).toBe(false);
  });

  describe('real environment', () => {
    // These tests exercise `newRequestId()` against the actual runtime
    // (no `globalThis.crypto` shim) so we catch regressions where the
    // helper accidentally stops delegating to `crypto.randomUUID()`.
    const hasRealRandomUUID =
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto?.randomUUID === 'function';

    const itIfRealCrypto = hasRealRandomUUID ? it : it.skip;

    itIfRealCrypto('newRequestId() returns a value matching UUID_V4_REGEX', () => {
      expect(newRequestId()).toMatch(UUID_V4_REGEX);
    });

    itIfRealCrypto('two consecutive newRequestId() calls produce distinct values', () => {
      const first = newRequestId();
      const second = newRequestId();
      expect(first).toMatch(UUID_V4_REGEX);
      expect(second).toMatch(UUID_V4_REGEX);
      expect(first).not.toBe(second);
    });
  });

  describe('isUuidV4 negative cases', () => {
    it('rejects control characters embedded in the middle of the string', () => {
      // Newline inserted between the version nibble and the next group.
      expect(isUuidV4('abcdef12-3456-7\n890-1234-56789abcdef')).toBe(false);
      // NUL byte embedded between groups.
      expect(isUuidV4('abcdef12-3456-4789-0123-456789abcd\0ef')).toBe(false);
      // Tab embedded in the middle.
      expect(isUuidV4('abcdef12-\t3456-4789-0123-456789abcdef')).toBe(false);
      // Carriage return embedded in the middle.
      expect(isUuidV4('abcdef12-3456-4789-\r0123-456789abcdef')).toBe(false);
    });

    it('rejects other random control characters anywhere in the string', () => {
      expect(isUuidV4('abcdef12\x01-3456-4789-0123-456789abcdef')).toBe(false);
      expect(isUuidV4('abcdef12-3456-4789-0123-456789abcde\x1f')).toBe(false);
    });

    it('rejects empty strings and other malformed shapes', () => {
      expect(isUuidV4('')).toBe(false);
      expect(isUuidV4('not-a-uuid')).toBe(false);
      expect(isUuidV4(`${UUID_A} `)).toBe(false);
      expect(isUuidV4(` ${UUID_A}`)).toBe(false);
    });
  });
});
