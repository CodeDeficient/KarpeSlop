# Security Policy for KarpeSlop

## License

KarpeSlop is released under the MIT License - see the [LICENSE](LICENSE) file for details.

## Supported Versions

Only the latest version is supported with security updates.

## Reporting a Vulnerability

If you discover a security vulnerability in KarpeSlop, please report it privately:

- Open a private report at https://github.com/CodeDeficient/KarpeSlop/security/advisories/new, or email codedeficient@gmail.com
- Please provide a detailed description of the vulnerability
- Include steps to reproduce if possible
- We will acknowledge receipt within 48 hours
- We will respond with either a fix timeline or explanation within 1 week

## Network Access

KarpeSlop makes HTTPS requests to the public npm registry (`registry.npmjs.org`) during a normal scan:

- For each dependency version in `package.json` (caret and tilde ranges) and `package-lock.json`, it fetches the package's metadata to check how recently that version was published.
- For each imported package that is neither declared in a `package.json` nor installed, it sends a `HEAD` request to check whether the package exists. This check only runs for files that have a `package.json` above them.

Those requests reveal the names of your dependencies and imports to the registry, along with a `User-Agent: karpeslop/<version>` header. No source code, file paths or other data is sent, and nothing is sent anywhere else. Set `KARPESLOP_OFFLINE=1` to turn all registry requests off.

KarpeSlop does not:
- Collect telemetry or analytics
- Store any user information
- Store tokens or credentials

## Known Security Posture

- The tool reads local files as specified in its execution and writes `ai-slop-report.json` in the current directory
- It does not execute code found in the scanned files; bundler configs are read as text
- Built-in rules are fixed in the source; `customPatterns` regexes come only from your own config file (`.karpesloprc.json`, `.karpesloprc` or `karpeslop.config.json`)
- The tool has minimal dependencies to reduce attack surface
