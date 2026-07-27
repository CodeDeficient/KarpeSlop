/**
 * Test fixture: Known False Positives
 * This file should produce ZERO issues when scanned by KarpeSlop.
 * Each section corresponds to a GitHub issue.
 *
 * If any of these patterns are flagged, the detector has a bug.
 */

// ============================================================
// Issue #7: substring matching on 'refetch' function name
// refetch() contains "fetch" but is NOT a fetch call
// ============================================================

function useDataFetcher() {
    const refetch = () => { return; };
    void refetch();
}

async function mutationHandler() {
    const { refetch } = { refetch: async () => {} };
    await refetch();
}

const retryRefetch = () => {
    refetch();
};

// ============================================================
// Issue #6: fetch() in JSDoc comments should be ignored
// ============================================================

/**
 * Fetches nearby food trucks within a given radius.
 * @param lat - The latitude coordinate
 * @param lng - The longitude coordinate
 * @param radius - Search radius in meters
 * @returns An array of nearby food trucks
 *
 * @example
 * ```tsx
 * const response = await fetch(`/api/trucks/nearby?lat=${lat}&lng=${lng}&radius=${radius}`);
 * return response.json();
 * ```
 */
async function fetchNearbyTrucks(lat: number, lng: number, radius: number) {
    return [];
}

/**
 * Custom hook for fetching data with error handling.
 *
 * @example
 * ```tsx
 * retry={() => refetch()}
 * const response = await fetch(`/api/endpoint`);
 * ```
 */
function useCustomHook() {
    return {};
}

/**
 * @example
 * const data = await fetch('/api/admin/data-cleanup', { method: 'POST' });
 */
function exampleWithFetchInJsDoc() {}

// ============================================================
// Issue #8: fetch() inside try/catch should NOT be flagged
// ============================================================

async function fetchWithTryCatch() {
    try {
        const response = await fetch('/api/trucks/...', {});
        if (!response.ok) {
            throw new Error(`Failed: ${response.status}`);
        }
    } catch (error_) {
        console.error('API error:', error_);
        throw error_;
    }
}

async function cleanupData() {
    try {
        const response = await fetch('/api/admin/data-cleanup', {
            method: 'POST',
        });
        if (!response.ok) throw new Error('Cleanup failed');
    } catch (error) {
        console.error('Error:', error);
    }
}

const runCleanup = async () => {
    try {
        const response = await fetch('/api/admin/data-cleanup', {});
        return await response.json();
    } catch (error) {
        console.error('Error:', error);
    }
};

async function claimTruck(truckId: string) {
    try {
        const response = await fetch('/api/auth/auto-claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ truckId }),
        });
        if (!response.ok) {
            throw new Error('Failed to claim truck');
        }
    } catch (error) {
        console.error('Claim failed:', error);
        throw error;
    }
}

// ============================================================
// Issue #2a: unsafe_double_type_assertion in English comments
// ============================================================

// Hide the instant skeleton as soon as React hydrates
// Process the data as quickly as possible
// Run the animation as smooth as desired

// Inline comment variant — should NOT trigger unsafe_double_type_assertion
const msg = getMsg(); // as soon as React hydrates

// ============================================================
// Issue #2b: console.log with conditional guards
// ============================================================

const isDev = process.env.NODE_ENV === 'development';

if (isDev) console.log('Service Worker registered');
if (isDev) console.log('Debug mode enabled');

if (process.env.DEBUG) {
    console.log('Debug info available');
}

const shouldLog = true;
if (shouldLog) console.log('Conditional log');
if (shouldLog) console.warn('Conditional warning');
if (shouldLog) console.info('Conditional info');

// ============================================================
// Also: fetch with .catch() in promise chain should NOT be flagged
// ============================================================

async function fetchWithPromiseCatch() {
    fetch('/api/data')
        .then(res => res.json())
        .catch(err => console.error('Fetch failed:', err));
}

export {
    useDataFetcher,
    fetchNearbyTrucks,
    fetchWithTryCatch,
    cleanupData,
    claimTruck,
    fetchWithPromiseCatch,
};
