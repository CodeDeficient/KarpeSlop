/**
 * T5: AST Analyzer Test - Complex Function
 * Should detect: high complexity, too many params, deep nesting
 */

function extremelyComplexFunction(
    param1: string,
    param2: number,
    param3: boolean,
    param4: object,
    param5: string[],
    param6: () => void  // 6 params - should trigger too_many_parameters
) {
    // Nested structure for complexity and nesting depth
    if (param1) {
        if (param2 > 0) {
            for (const item of param5) {
                if (param3) {
                    while (param2 > 0) {  // Deep nesting - should trigger excessive_nesting_depth
                        if (item === 'test' && param1 === 'a' || param3) {  // Adds complexity
                            console.log('deeply nested');
                        }
                    }
                }
            }
        }
    }

    // More complexity: ternary and logical operators
    const result = param1 ? param2 > 0 && param3 : param4 || param5.length > 0;

    return result;
}

export { extremelyComplexFunction };
