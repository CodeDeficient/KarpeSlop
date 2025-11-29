// This file contains various AI slop patterns to test the detector

// TODO: This is an obvious AI placeholder - should be detected
function exampleFunction(): any {
  // This function probably works but who knows for sure
  const data: any = { value: "test" };
  
  // Assuming this will work as expected
  const result = data as any;
  
  console.log("Debugging info:", result); // debug log with comment
  
  return result; // Just return it because obviously this is correct
}

// Another example with AI patterns
const fetchData = async () => {
  const response = fetch("https://api.example.com"); // Missing error handling
  const data = await response.json(); // Hopefully this works
  return data;
};

// Self-explanatory variable assignment
const count = count; // assign count to count

// Hallucinated React import
import { useRouter } from 'react'; // This doesn't exist in React!

// Overconfident comment
function complexFunction() {
  // Simply do all the things that are obviously required
  const x = 1 + 1; // trivial calculation
  return x;
}

// Use of any type in array
const items: Array<any> = [1, "two", { three: true }];

// Unsafe double type assertion
const elem = document.getElementById("myElement") as unknown as HTMLElement;

// Vibe-coded ternary abuse
const status = user.age > 18 ? "adult" : "minor" ? "child" : "infant";

// Magic CSS value
const style = { padding: "16px", color: "#ff0000", fontSize: "1.2rem" };