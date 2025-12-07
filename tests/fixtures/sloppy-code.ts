/**
 * Test fixture: Sloppy AI-generated code
 * This file contains intentionally bad code patterns for testing KarpeSlop detection
 */

// CRITICAL: Hallucinated imports (should be caught as critical severity)
import { useRouter, Link } from 'react';
import { getServerSideProps } from 'react';

// HIGH: any type usage
const data: any = {};
const items: Array<any> = [];
function processData(input: any): any {
    return input as any;
}

// HIGH: Unsafe type assertions
const result = someValue as any;
const double = value as string as number;

// HIGH: TODO placeholders where AI gave up
// TODO: implement the actual logic here
// FIXME: add proper validation

// HIGH: Overconfident comments
// obviously this works
// simply call the function
// just do this

// HIGH: Hedging comments  
// should work hopefully
// probably correct
// might work

// HIGH: Assumptions
// assuming that the data is valid
// apparently this is the correct approach

// MEDIUM: useEffect derived state (React anti-pattern)
function BadComponent() {
    const [derived, setDerived] = useState(0);

    useEffect(() => {
        setDerived(props.value * 2);
    }, [props.value]);
}

// MEDIUM: Empty dependency array (suspicious)
useEffect(() => {
    fetchData();
}, []);

// HIGH: setState in a loop
for (const item of items) {
    setCount(count + 1);
}

// MEDIUM: Console logs in production
console.log('Debug:', someValue);
console.error('Error occurred');

// LOW: Magic CSS values
const style = { width: '350px', color: '#FF5733' };

// MEDIUM: Nested ternary abuse
const status = isLoading ? 'loading' : isError ? 'error' : isSuccess ? 'success' : 'idle';

// HIGH: Complex function for AST analysis to catch
function extremelyComplexFunction(
    param1: string,
    param2: number,
    param3: boolean,
    param4: object,
    param5: any[],
    param6: Function
) {
    if (param1) {
        if (param2 > 0) {
            if (param3) {
                for (const item of param5) {
                    if (item) {
                        while (param2 > 0) {
                            try {
                                if (typeof item === 'string') {
                                    // Deeply nested
                                }
                            } catch (e) {
                                // Catch block adds complexity
                            }
                        }
                    }
                }
            }
        }
    }
    return param1 && param2 && param3 || param4 ? param5 : param6;
}

export default {};
