# Contributing to Nucleus

Thank you for considering contributing to Nucleus! This document outlines the contribution workflow and best practices.

## Branch Strategy

We follow a streamlined branch strategy:

- `main`: Production-ready code that is deployed automatically
- `feature/*`: New feature development (e.g., `feature/user-profile`)
- `fix/*`: Bug fixes (e.g., `fix/login-error`)
- `release/*`: Release preparation (e.g., `release/v1.0.0`)

## Development Workflow

1. **Create a branch**:
   ```
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Follow the code style and conventions
   - Write clean, readable code
   - Include comments where necessary

3. **Commit your changes**:
   ```
   git commit -m "Brief description of changes"
   ```
   
   Commit messages should:
   - Be clear and concise
   - Start with a verb (Add, Fix, Update, Refactor, etc.)
   - Describe what was changed and why

4. **Push your branch**:
   ```
   git push origin feature/your-feature-name
   ```

5. **Create a Pull Request**:
   - Fill out the PR template
   - Reference any related issues
   - Request reviews from team members

6. **Address review feedback**:
   - Make requested changes
   - Push additional commits to your branch

7. **Merge to main**:
   - Once approved, your PR can be merged
   - The CI/CD pipeline will automatically deploy your changes

## Code Standards

- Follow TypeScript best practices
- Use functional components for React
- Maintain type safety throughout the codebase
- Write tests for new features
- Keep dependencies up to date

## Pull Request Guidelines

- PRs should focus on a single feature or fix
- Include screenshots for UI changes
- List any breaking changes
- Ensure CI checks pass
- Keep PRs as small as possible for easier review

## Environment Setup

See the [Getting Started Guide](./GETTING_STARTED.md) for detailed environment setup instructions.

## Deployment

Deployment is handled automatically through Vercel:

1. Merges to `main` trigger automatic deployments
2. Preview deployments are created for all PRs

## Questions?

If you have any questions about contributing, please reach out to the project maintainers.
