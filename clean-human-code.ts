/**
 * Clean human-written code that should NOT be flagged as AI slop
 */

// Legitimate use of 'any' for JSON parsing - this is acceptable
function parseApiResponse(response: string): any {
  try {
    return JSON.parse(response);
  } catch (error) {
    console.error('Failed to parse response:', error);
    return null;
  }
}

// Common helper function with legitimate conditional logic
function formatUserStatus(user: { active: boolean; suspended: boolean }): string {
  if (user.suspended) {
    return 'SUSPENDED';
  } else if (user.active) {
    return 'ACTIVE';
  } else {
    return 'INACTIVE';
  }
}

// Legitimate simple conditional that shouldn't be flagged
function processUser(users: any[], userId: number) {
  const userIndex = users.findIndex(user => user.id === userId);
  
  if (userIndex === -1) {
    return { error: 'User not found' };
  }
  
  const user = users[userIndex];
  return { success: true, user };
}

// This is well-documented code with clear logic
function calculateTax(amount: number): number {
  // Tax calculation based on current local regulations
  return amount * 0.08;
}

// Simple for loop that should not be flagged as complex
function findMaxValue(numbers: number[]): number | null {
  if (numbers.length === 0) {
    return null;
  }
  
  let max = numbers[0];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > max) {
      max = numbers[i];
    }
  }
  return max;
}

// Multiple legitimate uses of 'any' for generic data processing
function processData(data: any[]): any[] {
  return data.map(item => {
    if (typeof item === 'object' && item !== null) {
      return { ...item, processed: true };
    }
    return item;
  });
}

// Legitimate console log for debugging in development
function debugUser(user: any) {
  console.log('Debug user:', user);
}

export { parseApiResponse, formatUserStatus, processUser, calculateTax, findMaxValue, processData, debugUser };