/**
 * T7: Context-Aware Whitelisting Test
 *
 * Code-level suppression via eslint-disable, @ts-ignore, and @ts-expect-error
 * does NOT suppress findings. Only config-level severityOverrides may silence
 * findings. These lines SHOULD be flagged despite the inline directives.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const acknowledged1: any = {};  // Should be DETECTED — code-level suppression removed

// @ts-expect-error - intentional for testing
const acknowledged2: any = {};  // Should be DETECTED — code-level suppression removed

const notAcknowledged: any = {};  // Should be DETECTED

export { };
