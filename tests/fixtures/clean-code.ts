/**
 * Test fixture: Clean code
 * This file should produce minimal or no issues when scanned by KarpeSlop
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

interface User {
    id: string;
    name: string;
    email: string;
}

interface UserListProps {
    users: User[];
    onSelect: (user: User) => void;
}

/**
 * A well-structured component that displays a list of users
 */
function UserList({ users, onSelect }: UserListProps) {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Memoized derived value - better than useEffect for state sync
    const selectedUser = useMemo(
        () => users.find(u => u.id === selectedId),
        [users, selectedId]
    );

    // Properly typed callback with correct dependencies
    const handleSelect = useCallback((user: User) => {
        setSelectedId(user.id);
        onSelect(user);
    }, [onSelect]);

    // Early return for edge case
    if (users.length === 0) {
        return <p>No users found </p>;
    }

    return (
        <ul>
        {
            users.map(user => (
                <li 
          key= { user.id }
          onClick = {() => handleSelect(user)}
        >
        { user.name }
        </li>
    ))
}
</ul>
  );
}

/**
 * Helper function with proper typing and error handling
 */
async function fetchUsers(): Promise<User[]> {
    try {
        const response = await fetch('/api/users');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data: unknown = await response.json();

        // Runtime type validation
        if (!Array.isArray(data)) {
            throw new Error('Expected array');
        }

        return data as User[];
    } catch (error) {
        if (error instanceof Error) {
            console.error('Failed to fetch users:', error.message);
        }
        return [];
    }
}

export { UserList, fetchUsers };
export type { User, UserListProps };
