/**
 * T6: React Anti-Pattern Detection
 */
import { useState, useEffect, useCallback } from 'react';

function BadComponent({ value }: { value: number }) {
    const [derived, setDerived] = useState(0);

    // Should detect: useEffect_derived_state
    useEffect(() => {
        setDerived(value * 2);
    }, [value]);

    // Should detect: useEffect_empty_deps_suspicious
    useEffect(() => {
        console.log('runs only once?');
    }, []);

    // Should detect: useCallback_no_deps
    const handler = useCallback(() => {
        console.log(value); // uses value but deps is empty!
    }, []);

    return null;
}

// Should detect: setState_in_loop
function LoopComponent({ items }: { items: string[] }) {
    const [count, setCount] = useState(0);

    for (const item of items) {
        setCount(count + 1);  // Bad! setState in loop
    }

    return null;
}

export { BadComponent, LoopComponent };
