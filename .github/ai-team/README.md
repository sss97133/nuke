# Nuke AI Development Organization

Welcome to your AI Development Organization! This system creates a structured way for you to interact with specialized AI teams that understand your codebase and can help guide development decisions.

## How It Works

1. You "meet" with different teams by triggering the AI team meeting workflow
2. Each team has specialized knowledge about their area of responsibility
3. They'll analyze your codebase and ask you targeted questions
4. Your answers guide the AI in implementing solutions aligned with your vision

## Available Teams

### Leadership

- [CTO (Chief Technology Officer)](./leadership-cto.md) - Technical strategy and architecture
- [Product Manager](./team-frontend.md) - Feature prioritization and roadmap
- [DevOps Lead](./team-devops.md) - Deployment and infrastructure

### Engineering Teams

- [Frontend Team](./team-frontend.md) - UI components and design system
- [Backend Team](./team-backend.md) - Supabase integration and data architecture
- QA & Testing Team - Quality assurance and test automation
- Security & Compliance Team - Security and data protection

## How to Schedule a Meeting

1. Go to the "Actions" tab in GitHub
2. Select the "AI Dev Team Meeting" workflow
3. Click "Run workflow"
4. Fill in the meeting parameters:
   - Select which team you want to meet with
   - Enter a meeting topic
   - Choose the meeting type
   - Set the priority

The system will:

1. Analyze your codebase for relevant information
2. Create a meeting agenda with targeted questions
3. Store the meeting in the `.github/ai-team/meetings` directory
4. Generate a GitHub discussion for your input

## Example Use Cases

### For Supabase Environment Configuration

Schedule a meeting with the Backend Team or CTO about "Environment Variable Management" to discuss optimizing the three-tier fallback system.

### For UI Design and CSS Issues

Meet with the Frontend Team about "Production CSS Reliability" to enhance the StyleFix approach and ensure consistent design.

### For CI/CD and Deployment Strategies

Consult with the DevOps team about "Deployment Workflow Optimization" to refine the Smart Repair Orchestrator.

## Best Practices

1. Be specific about meeting topics
2. Answer all questions in the meeting agenda
3. Use regular meetings to maintain development momentum
4. Review meeting artifacts to track decisions

This structured approach creates a collaborative AI development environment where you remain in control as the product visionary while leveraging specialized AI expertise for implementation details.
