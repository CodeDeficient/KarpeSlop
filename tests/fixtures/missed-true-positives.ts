/**
 * Test fixture: Missed true positives
 * Each section is a pre-existing bug where KarpeSlop should detect
 * something but doesn't. After fixes, all these patterns SHOULD be flagged.
 */

// ============================================================
// Bug #2: overconfident_comment regex misses when word follows subject
// Pattern: /\/\/\s*(obviously|clearly|simply|...)\b/
// Missing: "This is obviously wrong" — no .* between // and the word
// ============================================================

// This is obviously the right approach
// The code clearly handles edge cases
// We simply need to refactor this
// This will basically work as expected
// The component is literally just a wrapper
// This is naturally the best solution

// ============================================================
// Bug #4: isInTryCatchBlock scope — console.error outside catch
// The method finds ANY catch() above and returns true, ignoring scope
// This console.error is NOT in a catch block and SHOULD be flagged
// ============================================================

function exampleWithCatch() {
    try {
        doSomething();
    } catch (error) {
        console.error('caught error:', error);
    }
}

function unrelatedFunction() {
    console.error('not in a catch block');
}

async function anotherUnrelated() {
    console.error('also not in catch');
    return null;
}

// ============================================================
// Bug #5: magic_css_value regex \b prevents hex color matching
// #FF0000, #abc123, etc. never match because # is not a word char
// These SHOULD be flagged
// ============================================================

const styles = {
    primary: '#FF0000',
    secondary: '#00ff00',
    muted: '#abc123',
    background: '#1a1a2e',
    accent: '#e94560',
};

export { exampleWithCatch, unrelatedFunction, anotherUnrelated, styles };
