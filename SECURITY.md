# Security Policy for KarpeSlop

## License

KarpeSlop is released under the MIT License - see the [LICENSE](LICENSE) file for details.

## Supported Versions

Only the latest version is supported with security updates.

## Reporting a Vulnerability

If you discover a security vulnerability in KarpeSlop, please report it responsibly:

- Email: [Your email address for security reports]
- Please provide a detailed description of the vulnerability
- Include steps to reproduce if possible
- We will acknowledge receipt within 48 hours
- We will respond with either a fix timeline or explanation within 1 week

## Security Features

KarpeSlop is designed to run on local codebases and does not:
- Send data to external servers
- Store any user information
- Collect telemetry or analytics
- Access network resources during normal operation
- Store tokens or credentials in the codebase

## Known Security Posture

- The tool only reads local files as specified in its execution
- It does not execute code found in the scanned files
- Regex patterns are pre-defined and do not come from external sources
- The tool has minimal dependencies to reduce attack surface
