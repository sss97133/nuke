
# Theorem Explain Agent

## Overview

The Theorem Explain Agent is a React-based module that visualizes mathematical theorems from the TIGER-Lab/TheoremExplainBench dataset. It uses AI planning and code generation to create educational visualizations that help users understand complex mathematical concepts.

## Component Architecture

The Theorem Explain Agent follows a modular architecture with clearly separated concerns:

```
theorem-explain/
├── hooks/             # Custom React hooks for state management
│   ├── useTabState.ts        # Manages active tab state
│   ├── useTheoremData.ts     # Fetches and manages theorem data
│   ├── usePlanner.ts         # Handles planning visualization steps
│   ├── useCodeGenerator.ts   # Manages code generation and fixes
├── TheoremCard.tsx    # Displays selected theorem information
├── PlannerTab.tsx     # Shows planning steps for visualization
├── CodeTab.tsx        # Displays generated code with error handling
├── OutputTab.tsx      # Renders the visualization output
├── DocumentationSection.tsx  # Provides additional documentation
├── types.ts           # TypeScript type definitions
└── README.md          # This documentation file
```

## Main Component Flow

The application flow follows these high-level steps:

1. Fetch theorem data from TIGER-Lab/TheoremExplainBench
2. Display the selected theorem in TheoremCard
3. Generate a plan for visualizing the theorem in PlannerTab
4. Generate visualization code in CodeTab
5. Render the visualization in OutputTab

## Hook Interactions

The custom hooks work together to manage state and logic across the application:

```
    ┌───────────────────┐
    │   useTheoremData  │
    └─────────┬─────────┘
              │ selectedTheorem
              ▼
    ┌───────────────────┐      ┌───────────────────┐
    │     usePlanner    │◄─────┤    useTabState    │
    └─────────┬─────────┘      └─────────┬─────────┘
              │ planCompleted          │ activeTab
              ▼                        │
    ┌───────────────────┐              │
    │  useCodeGenerator │◄─────────────┘
    └───────────────────┘
```

### Hook Descriptions

#### `useTheoremData`

Responsible for fetching theorem data from the TIGER-Lab/TheoremExplainBench dataset and managing the currently selected theorem. It provides:

- Theorem data fetching and transformation
- Selected theorem state management
- Loading state for API calls

#### `usePlanner`

Manages the planning process for visualizing a theorem. This includes:

- Step-by-step planning workflow
- Planning status tracking
- Plan completion state

#### `useCodeGenerator`

Handles code generation for theorem visualizations based on the completed plan. Features include:

- Code generation triggering
- Error detection and fixing
- Loading and completion states

#### `useTabState`

Controls the active tab in the UI, allowing navigation between the Planner, Code, and Output sections. It:

- Tracks the active tab
- Provides tab switching functionality
- Logs tab changes for debugging

## Component Descriptions

### `TheoremExplainAgent`

The main container component that orchestrates all sub-components and hooks. It fetches data, manages state, and renders the appropriate UI based on user interactions.

### `TheoremCard`

Displays information about the selected theorem, including its name and definition. It also provides a button to start the planning process.

### `PlannerTab`

Shows the step-by-step planning process for visualizing the theorem. It displays each plan step with its completion status and allows proceeding to code generation when planning is complete.

### `CodeTab`

Displays the generated visualization code, highlights errors, and provides options to fix issues or view the output. It includes syntax highlighting and error handling.

### `OutputTab`

Renders the final visualization of the theorem along with detailed information about the theorem. This is where users can interact with the educational visualization.

### `DocumentationSection`

Provides additional documentation about the theorem explanation system, including information about the query generator, core documentation, and plugin documentation.

## Data Flow

1. `TheoremExplainAgent` initializes and uses `useTheoremData` to fetch theorem data
2. User selects a theorem, which updates the `selectedTheorem` state
3. User clicks "Generate Plan" to start the planning process with `usePlanner`
4. Upon plan completion, user navigates to the Code tab (via `useTabState`)
5. User generates code using `useCodeGenerator`, which may detect and fix errors
6. Upon successful code generation, user navigates to the Output tab to view the visualization

## Extending the System

To add new capabilities:

1. **New Theorem Types**: Extend the `TheoremData` interface in `types.ts`
2. **Additional Planning Steps**: Modify the plan steps array in `usePlanner`
3. **Code Generation Improvements**: Enhance the `useCodeGenerator` hook
4. **New Visualizations**: Add rendering capabilities to `OutputTab`

## Error Handling

The system includes robust error handling for:
- API failures during theorem data fetching
- Planning process interruptions
- Code generation errors with automatic fixing capabilities
- Rendering issues in the visualization output

## Performance Considerations

- Theorem data is fetched only once on component mount
- Planning and code generation are initiated on-demand
- Tab switching is optimized to minimize re-renders
