# CodeQL Configuration

This directory contains configuration files for GitHub's CodeQL security scanning.

## What is CodeQL?

CodeQL is GitHub's semantic code analysis engine. It enables you to find vulnerabilities and errors in your project's code. CodeQL powers GitHub code scanning, which helps you identify and fix potential security vulnerabilities before they reach production.

## Configuration Customizations

The `codeql-config.yml` file in this directory contains the following customizations:

1. **Focus on Security**: We use the `security-extended` query suite, which focuses on critical security issues but avoids many of the more pedantic code quality checks.

2. **Path Inclusions/Exclusions**: We've configured the analyzer to focus on source code and ignore test files, node modules, and build artifacts.

3. **Disabled Queries**: We've disabled several CodeQL queries that are known to produce false positives in JavaScript/TypeScript projects like ours, specifically:
   - Incomplete URL sanitization
   - Incomplete sanitization
   - Missing rate limiting
   - JWT verification issues
   - Randomness issues
   - Various injection checks that are irrelevant to our project architecture

## Why These Changes?

The default CodeQL settings are very strict and can generate many false positives, especially in modern JavaScript frameworks. These settings strike a balance between:

1. Finding genuine security issues that matter
2. Reducing noise from false positives
3. Ensuring the build doesn't fail due to minor issues

## Maintaining This Configuration

If you need to adjust this configuration:

1. Consult the [CodeQL documentation](https://codeql.github.com/docs/) for query reference
2. Use the [CodeQL query help site](https://codeql.github.com/codeql-query-help/) to understand specific queries
3. If removing an exclusion, ensure you've considered the potential for false positives

## Best Practices

- Review security scan results regularly
- Don't ignore genuine security issues
- Update this configuration as the codebase evolves
- Test changes to the configuration before committing

For more information, see GitHub's [CodeQL documentation](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/configuring-code-scanning).