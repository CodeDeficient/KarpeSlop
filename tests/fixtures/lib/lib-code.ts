/**
 * Test: lib/ directory should be scanned (bug #3)
 * The **/lib/** glob ignore was too broad, killing project source in lib/
 */

const data: any = {};

function processLibData(input: any): any {
    return input as any;
}

export { data, processLibData };
