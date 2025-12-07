// Test file with multiple repeated AI slop patterns to test consolidation

let data: any = { value: "test" }; // : any type annotation
const result = data as any; // unsafe type assertion

// TODO: implement this properly
function example1(): any {
  // This probably works
  return result; // Just return it
}

// Another function with same patterns
let another: any = { value: "test2" }; // : any type annotation
const result2 = another as any; // unsafe type assertion

// TODO: implement this properly - another occurrence
function example2(): any {
  // This probably works too
  return result2; // Just return it again
}