/**
 * T7: Context-Aware Whitelisting Test
 * These lines should NOT be flagged because they have explicit acknowledgment
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const acknowledged1: any = {};  // Should be SKIPPED

// @ts-expect-error - intentional for testing
const acknowledged2: any = {};  // Should be SKIPPED

// But this one should STILL be flagged (no acknowledgment)
const notAcknowledged: any = {};  // Should be DETECTED

export { };
