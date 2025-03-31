# Nuke Platform Development Rules

This document defines the rules and guidelines for AI assistance when developing the Nuke platform. These rules should be consistently applied across all development work to maintain code quality, architectural integrity, and security.

## Table of Contents

1. [Architecture Rules](#architecture-rules)
2. [Code Structure Rules](#code-structure-rules)
3. [Development Workflow Rules](#development-workflow-rules)
4. [Data Handling Rules](#data-handling-rules)
5. [Testing Rules](#testing-rules)
6. [Supabase Integration Rules](#supabase-integration-rules)
7. [Security Rules](#security-rules)
8. [UI/UX Rules](#uiux-rules)

---

## Architecture Rules

- **Always maintain the vehicle-centric architecture** where vehicles are first-class digital entities
- **Follow the digital identity component model** with timeline-based event aggregation
- **Implement the multi-source connector framework** for all data integrations
- **Use confidence scoring** for resolving conflicting information
- **Apply proper typing** for all database records and API responses
- **Enforce domain separation** between different functional areas
- **Maintain clear boundaries** between frontend components and backend services

## Code Structure Rules

- **Keep files under 200 lines maximum** to ensure modularity and readability
- **Always check for existing patterns** before creating new ones
- **Prefer iteration over existing patterns** rather than creating new approaches
- **Create modular components** with single responsibilities
- **Avoid code duplication** through proper abstraction
- **Use descriptive naming** for functions, components, and variables
- **Maintain consistent file structure** across the codebase
- **Break complex functions** into smaller, testable units
- **Implement clear separation of concerns** in all components
- **Favor functional components** over class components in React
- **Use declarative programming patterns** where possible

## Development Workflow Rules

- **After making changes, always start up a new server** for testing
- **Build one feature at a time** before moving to the next
- **Write tests for each new feature** before moving to the next
- **Run the full test suite** after making changes
- **Fix test failures immediately** by either updating code or tests
- **Commit code only after tests pass** to maintain a stable codebase
- **Use descriptive commit messages** that explain what changed and why
- **Consider git rollback for failed implementations** rather than fixing broken code
- **Maintain clean git history** for easier debugging and review
- **Update planning documents** when requirements or approach changes

## Data Handling Rules

- **Never create mock vehicle data** - this is an explicit user preference
- **Always use real vehicle IDs** with proper data structures
- **Use timeline-based event pattern** for all vehicle data functions
- **Implement confidence scoring** for all data sources
- **Verify data integrity** through validation and type checking
- **Handle data loading states** appropriately in the UI
- **Implement proper error handling** for data operations
- **Use proper cache invalidation** when data changes
- **Structure data for efficient querying** and display
- **Maintain data consistency** across different views

## Testing Rules

- **Write unit tests for all components** and utility functions
- **Create integration tests** for data flows and API interactions
- **Implement end-to-end tests** for critical user journeys
- **Use real vehicle data subsets** for testing scenarios
- **Test edge cases and error conditions** thoroughly
- **Ensure test independence** to avoid flaky tests
- **Maintain high test coverage** especially for core functionality
- **Run tests before committing changes** to maintain stability
- **Update tests when requirements change** to maintain accuracy
- **Test for accessibility** in all UI components

## Supabase Integration Rules

- **Use row-level security** for all database tables
- **Implement proper authentication** using Supabase capabilities
- **Consider different environments** (dev/test/prod) in configuration
- **Never commit API keys or secrets** to git
- **Use appropriate query methods** for different data operations
- **Handle Supabase asynchronous operations** correctly
- **Implement proper error handling** for Supabase operations
- **Use transactions** for operations that modify multiple tables
- **Optimize queries** for performance and efficiency
- **Properly handle Supabase environment-specific URLs**:
  - Development: `http://127.0.0.1:54321`
  - Database: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  - Supabase Studio: `http://127.0.0.1:54323`

## Security Rules

- **Implement rate limiting** on all API endpoints
- **Add CAPTCHA** for authentication routes
- **Never expose sensitive data** in client-side code
- **Validate all user inputs** before processing
- **Use parameterized queries** to prevent SQL injection
- **Implement proper authentication** for all protected routes
- **Use HTTPS** for all external communications
- **Follow the principle of least privilege** for data access
- **Implement proper session management** and timeout
- **Regularly audit security practices** and dependencies

## UI/UX Rules

- **Follow consistent design patterns** across the application
- **Ensure responsive design** for all screen sizes
- **Implement proper loading states** for asynchronous operations
- **Handle errors gracefully** with user-friendly messages
- **Ensure accessibility compliance** for all components
- **Use consistent terminology** throughout the interface
- **Provide clear feedback** for user actions
- **Implement proper form validation** with helpful error messages
- **Optimize performance** for core user interactions
- **Create intuitive navigation** with clear information architecture
