/**
 * T6b: React Anti-Pattern Detection - Single Line Version for testing
 */
import { useState, useEffect, useCallback } from 'react';

// Single-line versions that SHOULD be detected
const useEffectDerived = () => { useEffect(() => { setDerived(value * 2); }, [value]); }
const useEffectEmpty = () => { useEffect(() => { doSomething(); }, []); }
const useCallbackEmpty = () => { useCallback(() => { doSomething(); }, []); }

// setState in loop on single line
function loopBad() { for (const i of items) { setCount(i); } }

export { };
