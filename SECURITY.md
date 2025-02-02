# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within TAMS, please send an email to security@example.com. All security vulnerabilities will be promptly addressed.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Measures

1. **Authentication**: Implemented using Supabase with JWT tokens
2. **Database**: Row Level Security (RLS) policies in place
3. **API**: Rate limiting and input validation
4. **File Upload**: Virus scanning and file type validation
5. **Passwords**: Secure hashing using industry standards

## Best Practices

1. Keep dependencies updated
2. Use environment variables for sensitive data
3. Implement proper error handling
4. Regular security audits
5. Follow OWASP guidelines