/**
 * T1: Hallucinated Import Detection
 * MUST detect these - this is the core value proposition
 */

// This should be detected as CRITICAL - hallucinated React import
import { useRouter, Link, Image } from 'react';

// This should be detected as CRITICAL - hallucinated Next.js API from react
import { getServerSideProps } from 'react';

export { };
