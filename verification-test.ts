/**
 * Verification: Clean human-written code that should NOT be flagged as AI slop
 */

// Legitimate JSON parsing - should NOT be flagged
function parseResponse(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

// Legitimate simple conditional - should NOT be flagged
function findUser(users: any[], id: number): any | null {
  const userIndex = users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return null;
  }
  return users[userIndex];
}

// Legitimate data processing function - should NOT be flagged
function processApiResponse(data: any[]): any[] {
  return data.map(item => {
    if (typeof item === 'object' && item !== null) {
      return { ...item, processed: true };
    }
    return item;
  });
}

// Legitimate error handling - should NOT be flagged
async function fetchUserData(userId: number) {
  try {
    const response = await fetch(`/api/users/${userId}`);
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch user:', error);
    return null;
  }
}

// Simple for loop - should NOT be flagged as complex
function getMaxValue(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  let max = numbers[0];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > max) {
      max = numbers[i];
    }
  }
  return max;
}