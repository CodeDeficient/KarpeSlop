#!/usr/bin/env node

/**
 * AI Slop Detection Tool for Food Truck Finder Application
 * 
 * This tool identifies common AI-generated code patterns that represent "AI Slop" 
 * including excessive use of `any` types, unsafe type assertions, and other problematic patterns.
 * 
 * Follows industry best practices based on typescript-eslint patterns.
 */
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
class AISlopDetector {
  issues = [];
  targetExtensions = ['.ts', '.tsx', '.js', '.jsx'];

  // Core application directories to prioritize in reporting
  coreAppDirs = ['app/', 'components/', 'lib/', 'hooks/', 'services/'];
  detectionPatterns = [
  // ==================== AXIS 1: INFORMATION UTILITY (Noise) ====================
  {
    id: 'redundant_self_explanatory_comment',
    pattern: /const\s+(\w+)\s*=\s*\1\s*;?\s*\/\/.?(?:set|assign|store)\s+\1\b/gi,
    message: "Redundant comment explaining variable assignment to itself — peak AI slop",
    severity: 'high',
    description: 'e.g., const count = count; // assign count to count'
  }, {
    id: 'excessive_boilerplate_comment',
    pattern: /\/\/\s*This (?:function|component|hook|variable|method).* (?:does|is|handles?|returns?|takes?|processes?)/gi,
    message: "Boilerplate comment that restates the obvious — adds zero insight",
    severity: 'medium',
    description: 'AI-generated comments that explain the obvious'
  }, {
    id: 'debug_log_with_comment',
    pattern: /console\.(log|debug|info)\([^)]+\)\s*;\s*\/\/\s*(?:debug|temp|test|check|log|print)/gi,
    message: "Debug log with apologetic comment — AI trying to justify its existence",
    severity: 'medium',
    description: 'Debugging code that should not be in production',
    skipTests: true
  },
  // ==================== AXIS 2: INFORMATION QUALITY (Hallucinations) ====================
  {
    id: 'hallucinated_react_import',
    pattern: /import\s*{\s*(useRouter|useParams|useSearchParams|Link|Image|Script)\s*}\s*from\s*['"]react['"]/gi,
    message: "Hallucinated React import — these do NOT exist in 'react'",
    severity: 'critical',
    description: 'React-specific APIs are NOT in the react package'
  }, {
    id: 'hallucinated_next_import',
    pattern: /import\s*{\s*(getServerSideProps|getStaticProps|getStaticPaths)\s*}\s*from\s*['"]react['"]/gi,
    message: "Next.js API imported from 'react' — 100% AI hallucination",
    severity: 'critical',
    description: 'Next.js APIs are NOT in the react package'
  }, {
    id: 'todo_implementation_placeholder',
    pattern: /\/\/\s*(?:TODO|FIXME|HACK).*(?:implement|add|finish|complete|your code|logic|here)/gi,
    message: "AI gave up and wrote a TODO instead of thinking",
    severity: 'high',
    description: 'Placeholder comments where AI failed to implement'
  }, {
    id: 'assumption_comment',
    pattern: /\b(assuming|assumes?|presumably|apparently|it seems|seems like|probably|hopefully)\b.{0,50}\b(that|this|the|it)\b/gi,
    message: "AI making unverified assumptions — dangerous in production",
    severity: 'high',
    description: 'Comments indicating unverified assumptions'
  },
  // ==================== AXIS 3: STYLE / TASTE (The Vibe Check) ====================
  {
    id: 'overconfident_comment',
    pattern: /\/\/\s*(obviously|clearly|simply|just|easy|trivial|basically|literally|of course|naturally|certainly|surely)\b/gi,
    message: "Overconfident comment — AI pretending it understands when it doesn't",
    severity: 'high',
    description: 'Overconfident language indicating false certainty'
  }, {
    id: 'hedging_uncertainty_comment',
    pattern: /\b(should work|hopefully|probably|might work|try this|i think|seems to|attempting to|looks like|appears to)\b/gi,
    message: "AI hedging its bets — classic sign of low-confidence generation",
    severity: 'high',
    description: 'Uncertain language masked as implementation'
  }, {
    id: 'unnecessary_iife_wrapper',
    pattern: /\bconst\s+\w+\s*=\s*\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\}\)\(\)/g,
    message: "Unnecessary IIFE wrapper — AI over-engineering a simple async call",
    severity: 'medium',
    description: 'Unnecessarily complex function wrapping'
  }, {
    id: 'vibe_coded_ternary_abuse',
    pattern: /\?\s*['"][^'"]+['"]\s*:\s*['"][^'"]+['"]\s*\?\s*['"][^'"]+['"]\s*:\s*['"][^'"]+['"]/g,
    message: "Nested ternary hell — AI trying to look clever",
    severity: 'medium',
    description: 'Overly complex nested ternary operations'
  }, {
    id: 'magic_css_value',
    pattern: /\b(\d{3,4}px|#\w{6}|rgba?\([^)]+\)|hsl\(\d+)/g,
    message: "Magic CSS value — extract to design token or const",
    severity: 'low',
    description: 'Hardcoded CSS values that should be constants'
  },
  // ==================== ORIGINAL PATTERNS ====================
  {
    id: 'any_type_usage',
    pattern: /:\s*any\b/g,
    message: "Found 'any' type usage. Replace with specific type or unknown.",
    severity: 'high',
    description: 'Detects : any type annotations'
  }, {
    id: 'array_any_type',
    pattern: /Array\s*<\s*any\s*>/g,
    message: "Found Array<any> type usage. Replace with specific type or unknown[].",
    severity: 'high',
    description: 'Detects Array<any> patterns'
  }, {
    id: 'generic_any_type',
    pattern: /<\s*any\s*>/g,
    message: "Found generic <any> type usage. Replace with specific type or unknown.",
    severity: 'high',
    description: 'Detects generic type parameters with any'
  }, {
    id: 'function_param_any_type',
    pattern: /\(\s*.*\s*:\s*any\s*\)/g,
    message: "Found function parameter with 'any' type. Replace with specific type or unknown.",
    severity: 'high',
    description: 'Detects function parameters with any type'
  }, {
    id: 'unsafe_type_assertion',
    pattern: /\s+as\s+any\b/g,
    message: "Found unsafe 'as any' type assertion. Use proper type guards or validation.",
    severity: 'high',
    description: 'Detects unsafe as any assertions'
  }, {
    id: 'unsafe_double_type_assertion',
    pattern: /as\s+unknown\s+as\s+\w+/g,
    message: "Found unsafe 'as unknown as Type' type assertion. Use proper type guards or validation.",
    severity: 'high',
    description: 'Detects unsafe double type assertions'
  }, {
    id: 'index_signature_any',
    pattern: /\[\s*["'`]?(\w+)["'`]?[^\]]*\]\s*:\s*any/g,
    message: "Found index signature with 'any' type. Replace with specific type or unknown.",
    severity: 'high',
    description: 'Detects index signatures with any type'
  }, {
    id: 'missing_error_handling',
    pattern: /(fetch|axios|http)\s*\(/g,
    message: "Potential missing error handling for promise. Consider adding try/catch or .catch().",
    severity: 'medium',
    description: 'Detects calls that might need error handling',
    skipTests: true // Skip in test files since they often have different error handling patterns
  }, {
    id: 'production_console_log',
    pattern: /console\.(log|warn|error|info|debug|trace)\(/g,
    message: "Found console logging in production code. Remove before deployment.",
    severity: 'medium',
    description: 'Detects console logs in production code',
    skipTests: true,
    skipMocks: true
  }, {
    id: 'todo_comment',
    pattern: /(TODO|FIXME|HACK|XXX|BUG)\b/g,
    message: "Found TODO/FIXME/HACK comment indicating incomplete implementation.",
    severity: 'medium',
    description: 'Detects incomplete implementation markers'
  }, {
    id: 'complex_nested_conditionals',
    pattern: /(?:if\s*\(|for\s*\(|while\s*\()/g,
    message: "Found potentially complex nested control structures. Consider refactoring for readability.",
    severity: 'medium',
    description: 'Detects potential complex conditionals'
  }, {
    id: 'unsafe_member_access',
    pattern: /\.\s*any\s*\[/g,
    message: "Found potentially unsafe member access on 'any' type.",
    severity: 'high',
    description: 'Detects unsafe member access patterns'
  }];
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  /**
   * Run the AI Slop detection across the codebase
   */
  async detect(quiet = false) {
    console.log('🔍 Starting AI Slop detection...\n');

    // 1. Find all TypeScript/JavaScript files
    const allFiles = this.findAllFiles();

    // Filter files based on quiet mode (skip non-core files if quiet is true)
    const filesToAnalyze = quiet ? allFiles.filter(file => {
      const relativePath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      return this.coreAppDirs.some(dir => relativePath.startsWith(dir));
    }) : allFiles;
    console.log(`📁 Found ${allFiles.length} files to analyze (${filesToAnalyze.length} in ${quiet ? 'quiet' : 'full'} mode)\n`);

    // 2. Analyze each file for AI Slop patterns
    for (const file of filesToAnalyze) {
      this.analyzeFile(file, quiet);
    }

    // 3. Report findings
    this.generateReport(quiet);
    return this.issues;
  }

  /**
   * Find all TypeScript/JavaScript files in the project
   */
  findAllFiles() {
    const allFiles = [];
    for (const ext of this.targetExtensions) {
      const pattern = path.join(this.rootDir, `**/*${ext}`).replace(/\\/g, '/');
      const files = glob.sync(pattern, {
        ignore: ['node_modules/**', '.next/**', 'dist/**', 'build/**', 'coverage/**', 'generated/**',
        // Prisma generated files
        '.vercel/**',
        // Vercel build files
        '.git/**',
        // Git files
        '**/types/**',
        // Exclude type definition files
        '**/node_modules/**', '**/.*',
        // Hidden directories like .git (but not .tsx files)
        '**/*.d.ts',
        // Don't scan declaration files
        '**/coverage/**',
        // Coverage reports
        '**/out/**',
        // Next.js output directory
        '**/temp/**',
        // Temporary files
        '**/lib/**',
        // Generated library files
        'scripts/ai-slop-detector.ts',
        // Exclude the detector script itself to avoid false positives
        'ai-slop-detector.ts' // Also exclude when in root directory
        ]
      });

      // Additional filtering to remove any generated files that may have slipped through
      const filteredFiles = files.filter(file => {
        const relativePath = path.relative(this.rootDir, file).replace(/\\/g, '/');
        return !relativePath.includes('generated/') && !relativePath.includes('/generated') && !relativePath.startsWith('generated/') && !relativePath.includes('coverage/') && !relativePath.includes('.next/') && !relativePath.includes('node_modules/') && !relativePath.includes('dist/') && !relativePath.includes('build/') && !relativePath.includes('.git/') && !relativePath.includes('out/') && !relativePath.includes('temp/');
      });
      allFiles.push(...filteredFiles);
    }

    // Remove duplicates and return
    return [...new Set(allFiles)];
  }

  /**
   * Check if a fetch call is properly handled with try/catch or .catch()
   */
  isFetchCallProperlyHandled(lines, fetchLineIndex, fetchCallIndex) {
    // Look in a reasonable range around the fetch call to see if it's in a try/catch block
    // or has a .catch() or similar error handling

    // First, find the function context containing this fetch call
    let functionStart = -1;
    let functionEnd = -1;

    // Look backwards to find the start of the function
    for (let i = fetchLineIndex; i >= Math.max(0, fetchLineIndex - 20); i--) {
      const line = lines[i];
      if (line.includes('async function') || line.includes('function') || line.includes('=>') || line.includes('const') && (line.includes('useState') || line.includes('useEffect') || line.includes('useCallback') || line.includes('useMemo')) || line.includes('export default function')) {
        // Check if this looks like the start of our function
        if (line.includes('{') || line.includes('=>')) {
          functionStart = i;
          break;
        }
      }
      // Check for arrow functions in the line above
      if (i > 0 && (lines[i - 1] + line).includes('=>')) {
        // Look for functions that end with an opening brace
        if (line.trim().startsWith('{')) {
          functionStart = i;
          break;
        }
      }
    }

    // Look forwards to find the end of the function block
    let braceCount = 0;
    let inFunction = false;
    for (let i = functionStart === -1 ? 0 : functionStart; i < lines.length && i < fetchLineIndex + 20; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') {
          braceCount++;
          if (i === functionStart && braceCount === 1) {
            inFunction = true;
          }
        } else if (line[j] === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            functionEnd = i;
            break;
          }
        }
      }
      if (functionEnd !== -1) break;
    }
    if (functionStart === -1 || functionEnd === -1) {
      // If we can't find function boundaries, check the current line and nearby lines for error handling
      // Check current line and 2 lines before and after
      const start = Math.max(0, fetchLineIndex - 2);
      const end = Math.min(lines.length, fetchLineIndex + 3);
      for (let i = start; i < end; i++) {
        const line = lines[i];
        if (line.includes('.catch(') || line.includes('try {') || line.includes('try{') || i > 0 && lines[i - 1].includes('try') && line.includes('.catch(')) {
          return true;
        }
      }
      return false;
    }

    // Now check the entire function for try/catch or .catch
    for (let i = functionStart; i <= functionEnd; i++) {
      const line = lines[i];
      if (line.includes('.catch(') || line.includes('try {') || line.includes('try{')) {
        return true;
      }
    }

    // Check if the fetch call is part of a promise chain that ends with .catch
    const currentLine = lines[fetchLineIndex];
    if (currentLine.includes('fetch(') && (currentLine.includes('.then(') || currentLine.includes('.catch('))) {
      // Look for .catch in the same or following lines within the same statement
      for (let i = fetchLineIndex; i < Math.min(lines.length, fetchLineIndex + 5); i++) {
        const line = lines[i];
        if (line.includes('.catch(')) {
          return true;
        }
        // If we find another statement (not a continuation), stop looking
        if (line.includes(';') && !line.trim().endsWith('\\') && !line.trim().endsWith(',')) {
          break;
        }
      }
    }
    return false;
  }

  /**
   * Analyze a single file for AI Slop patterns
   */
  analyzeFile(filePath, quiet = false) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check if this is a test or mock file
    const isTestFile = filePath.includes('__tests__') || filePath.includes('.test.') || filePath.includes('.spec.') || filePath.includes('__mocks__') || filePath.includes('test-');
    const isMockFile = filePath.includes('__mocks__') || filePath.includes('mock');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Apply each detection pattern
      for (const pattern of this.detectionPatterns) {
        // Skip certain patterns in test/mock files
        if (pattern.skipTests && isTestFile || pattern.skipMocks && isMockFile) {
          continue;
        }

        // Create a new RegExp object for each check to reset lastIndex
        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        let match;
        while ((match = regex.exec(line)) !== null) {
          // Skip legitimate cases like expect.any() in tests
          if (pattern.id === 'any_type_usage' && (line.includes('expect.any(') || line.includes('jest.fn()'))) {
            continue;
          }

          // Skip JSX spread attributes which often legitimately use 'any'
          if (pattern.id === 'any_type_usage' && line.includes('{...') && line.includes('as any')) {
            continue;
          }

          // Special handling for missing error handling - look for properly handled fetch calls
          if (pattern.id === 'missing_error_handling') {
            // Check if this fetch call is part of a properly handled async function
            const isProperlyHandled = this.isFetchCallProperlyHandled(lines, i, match.index);
            if (isProperlyHandled) {
              continue; // Skip this fetch call as it's properly handled
            }
          }

          // Special handling for unsafe_double_type_assertion - skip legitimate UI library patterns
          if (pattern.id === 'unsafe_double_type_assertion') {
            // Check the full line context to identify legitimate UI library patterns
            const fullLine = line.trim();
            if (fullLine.includes('as unknown as React.ElementType') || fullLine.includes('as unknown as TooltipFormatter') || fullLine.includes('as unknown as import(') || fullLine.includes('as unknown as import ')) {
              continue; // Skip legitimate UI library patterns
            }
          }

          // In quiet mode, skip test and mock files for all patterns except production console logs
          if (quiet && pattern.id !== 'production_console_log') {
            const isTestFile = filePath.includes('__tests__') || filePath.includes('.test.') || filePath.includes('.spec.') || filePath.includes('__mocks__') || filePath.includes('test-');
            if (isTestFile) {
              continue;
            }
          }
          this.issues.push({
            type: pattern.id,
            file: filePath,
            line: lineNumber,
            column: match.index + 1,
            code: match[0],
            message: `${pattern.message} (${pattern.description})`,
            severity: pattern.severity
          });
        }
      }
    }
  }

  /**
   * Generate a detailed report of findings
   */
  generateReport(quiet = false) {
    console.log('📊 AI Slop Detection Report');
    console.log('============================\n');
    if (this.issues.length === 0) {
      console.log('✅ No AI Slop issues detected!');
      return;
    }

    // Group issues by severity
    const bySeverity = {
      critical: this.issues.filter(i => i.severity === 'critical'),
      high: this.issues.filter(i => i.severity === 'high'),
      medium: this.issues.filter(i => i.severity === 'medium'),
      low: this.issues.filter(i => i.severity === 'low')
    };
    console.log(`Found ${this.issues.length} AI Slop issues:`);
    console.log(`  Critical: ${bySeverity.critical.length}`);
    console.log(`  High:     ${bySeverity.high.length}`);
    console.log(`  Medium:   ${bySeverity.medium.length}`);
    console.log(`  Low:      ${bySeverity.low.length}\n`);

    // Display top issues by severity
    ['critical', 'high', 'medium', 'low'].forEach(severity => {
      const issues = bySeverity[severity];
      if (issues.length > 0) {
        console.log(`\n${severity.toUpperCase()} SEVERITY ISSUES:`);
        console.log(''.padStart(80, '-'));

        // Group by type for better organization
        const byType = {};
        issues.slice(0, 20).forEach(issue => {
          if (!byType[issue.type]) {
            byType[issue.type] = [];
          }
          byType[issue.type].push(issue);
        });
        Object.entries(byType).forEach(([type, typeIssues]) => {
          const sampleIssue = typeIssues[0];
          console.log(`\n📍 Pattern: ${type}`);
          console.log(`   Description: ${sampleIssue.message.split('(').pop()?.replace(')', '') || ''}`);
          console.log(`   Sample occurrences: ${typeIssues.length}`);

          // Show a few specific examples
          typeIssues.slice(0, 3).forEach(issue => {
            const relativePath = path.relative(this.rootDir, issue.file);
            console.log(`   → ${relativePath}:${issue.line} - ${issue.code}`);
          });
          if (typeIssues.length > 3) {
            console.log(`   ... and ${typeIssues.length - 3} more instances`);
          }
        });
        if (issues.length > 20) {
          console.log(`\n   ... and ${issues.length - 20} more issues of this severity`);
        }
      }
    });

    // Provide summary statistics
    console.log(`\n📈 SUMMARY STATISTICS:`);
    console.log(''.padStart(80, '-'));

    // Count by type
    const byType = {};
    this.issues.forEach(issue => {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
    });
    console.log('\nIssues by type:');
    Object.entries(byType).sort((a, b) => b[1] - a[1]) // Sort by count
    .slice(0, 10).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    // Files with most issues - show core application files separately
    const fileCounts = {};
    this.issues.forEach(issue => {
      fileCounts[issue.file] = (fileCounts[issue.file] || 0) + 1;
    });

    // Split files into core app files and others
    const allFiles = Object.entries(fileCounts);
    const coreAppFiles = allFiles.filter(([file]) => {
      const relativePath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      return this.coreAppDirs.some(dir => relativePath.startsWith(dir));
    });
    const otherFiles = allFiles.filter(([file]) => {
      const relativePath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      return !this.coreAppDirs.some(dir => relativePath.startsWith(dir));
    });

    // Show core application files separately
    const topCoreFiles = coreAppFiles.sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('\nTop CORE APPLICATION files with AI Slop issues:');
    if (topCoreFiles.length > 0) {
      topCoreFiles.forEach(([file, count]) => {
        const relativePath = path.relative(this.rootDir, file);
        console.log(`  ${relativePath}: ${count} issues ★`);
      });
    } else {
      console.log('  No core application files found with issues');
    }

    // In quiet mode, don't show other files (tests, scripts, mocks, etc.)
    if (!quiet) {
      // Also show other notable files if there's space
      const topOtherFiles = otherFiles.sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topOtherFiles.length > 0) {
        console.log('\nTop OTHER files with AI Slop issues (utilities, scripts, etc.):');
        topOtherFiles.forEach(([file, count]) => {
          const relativePath = path.relative(this.rootDir, file);
          console.log(`  ${relativePath}: ${count} issues`);
        });
      }
    }

    // Add KarpeSlop scoring
    const score = this.calculateKarpeSlopScore();
    console.log(`\nKARPATHY SLOP INDEX™`);
    console.log('═'.repeat(50));
    console.log(`Information Utility (Noise) : ${score.informationUtility} pts`);
    console.log(`Information Quality (Lies)  : ${score.informationQuality} pts`);
    console.log(`Style / Taste (Soul)        : ${score.style} pts`);
    console.log(`TOTAL KARPE-SLOP SCORE      : ${score.total} pts`);
    if (score.total === 0) {
      console.log(`\nCLEAN. Even Andrej would approve.`);
      console.log(`   "This codebase has taste." — @karpathy, probably`);
    } else if (score.total > 50) {
      console.log(`\nSUEEEY! Here piggy piggy... this codebase is 100% slop-fed.`);
    } else {
      console.log(`\nAcceptable. But Karpathy is watching.`);
    }
    console.log('\n🔧 Next Steps:');
    console.log('=============');
    console.log('1. Address critical and high severity issues first');
    console.log('2. Focus on removing `any` types and replacing with proper types');
    console.log('3. Add proper error handling to asynchronous operations');
    console.log('4. Refactor complex functions for better readability');
    console.log('5. Remove development artifacts like TODO comments and console logs');
  }

  /**
   * Get the number of issues found
   */
  getIssueCount() {
    return this.issues.length;
  }

  /**
   * Get issues by severity level
   */
  getIssuesBySeverity(severity) {
    return this.issues.filter(issue => issue.severity === severity);
  }

  /**
   * Export results to JSON for further processing
   */
  exportResults(outputPath) {
    // Group issues by severity
    const bySeverity = {
      critical: this.issues.filter(i => i.severity === 'critical'),
      high: this.issues.filter(i => i.severity === 'high'),
      medium: this.issues.filter(i => i.severity === 'medium'),
      low: this.issues.filter(i => i.severity === 'low')
    };
    const results = {
      timestamp: new Date().toISOString(),
      totalIssues: this.issues.length,
      bySeverity: {
        critical: bySeverity.critical.length,
        high: bySeverity.high.length,
        medium: bySeverity.medium.length,
        low: bySeverity.low.length
      },
      byType: Object.entries(this.getIssuesByType()).map(([type, issues]) => ({
        type,
        count: issues.length,
        sample: issues.slice(0, 3).map(issue => ({
          file: path.relative(this.rootDir, issue.file),
          line: issue.line,
          code: issue.code
        }))
      })),
      issues: this.issues
    };
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n📈 Results exported to: ${outputPath}`);
  }

  /**
   * Get issues grouped by type
   */
  getIssuesByType() {
    const byType = {};
    this.issues.forEach(issue => {
      if (!byType[issue.type]) {
        byType[issue.type] = [];
      }
      byType[issue.type].push(issue);
    });
    return byType;
  }

  /**
   * Calculate comprehensive KarpeSlop score based on the three axes
   */
  calculateKarpeSlopScore() {
    const weights = {
      // Critical hallucinations = instant fail
      hallucinated_react_import: 30,
      hallucinated_next_import: 30,
      // Type system poison
      any_type_usage: 15,
      unsafe_type_assertion: 12,
      unsafe_double_type_assertion: 12,
      // Soul death
      overconfident_comment: 10,
      hedging_uncertainty_comment: 10,
      todo_implementation_placeholder: 12,
      assumption_comment: 11,
      // Noise & bloat
      redundant_self_explanatory_comment: 8,
      excessive_boilerplate_comment: 6,
      debug_log_with_comment: 5,
      // Vibe crimes
      unnecessary_iife_wrapper: 7,
      vibe_coded_ternary_abuse: 6
    };
    let utility = 0,
      quality = 0,
      style = 0;
    for (const i of this.issues) {
      const w = weights[i.type] || 3;
      if (i.type.includes('hallucinated') || i.type.includes('todo') || i.type.includes('assumption')) quality += w;else if (i.type.includes('comment') || i.type.includes('redundant') || i.type.includes('boilerplate')) utility += w;else style += w;
    }
    const total = utility + quality + style;
    return {
      informationUtility: utility,
      informationQuality: quality,
      style,
      total
    };
  }
}

// Run the detector if this script is executed directly
async function runIfMain() {
  const rootDir = process.cwd();
  const detector = new AISlopDetector(rootDir);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet') || args.includes('-q');
  try {
    const issues = await detector.detect(quiet);
    // Export results to a JSON file for CI/CD integration
    const outputPath = path.join(rootDir, 'ai-slop-report.json');
    detector.exportResults(outputPath);
    const exitCode = issues.length > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('💥 AI Slop detection failed:', error);
    process.exit(1);
  }
}

// Check if this is the main module in ES modules
const currentFile = fileURLToPath(import.meta.url);
const mainFile = process.argv[1];
if (currentFile === mainFile) {
  runIfMain().catch(error => {
    console.error('💥 AI Slop detection failed:', error);
    process.exit(1);
  });
}
export { AISlopDetector };