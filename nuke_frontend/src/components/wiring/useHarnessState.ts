// useHarnessState.ts — Reducer-based state management for the harness builder

import { useReducer, useCallback } from 'react';
import type {
  HarnessState, HarnessAction, HarnessDesign, HarnessSection,
  HarnessEndpoint, WiringConnection, HarnessSelection, CanvasMode, DrawWireState,
} from './harnessTypes';

const initialState: HarnessState = {
  design: null,
  sections: [],
  endpoints: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selection: { type: null, id: null },
  mode: 'select',
  drawWire: null,
  isDirty: false,
};

function harnessReducer(state: HarnessState, action: HarnessAction): HarnessState {
  switch (action.type) {
    case 'SET_DESIGN':
      return {
        ...state,
        design: action.payload.design,
        sections: action.payload.sections,
        endpoints: action.payload.endpoints,
        connections: action.payload.connections,
        viewport: action.payload.design.canvas_state?.viewport || { x: 0, y: 0, zoom: 1 },
        isDirty: false,
      };

    case 'ADD_NODE':
      return {
        ...state,
        endpoints: [...state.endpoints, action.payload],
        isDirty: true,
      };

    case 'UPDATE_NODE':
      return {
        ...state,
        endpoints: state.endpoints.map(ep =>
          ep.id === action.payload.id ? { ...ep, ...action.payload.changes } : ep
        ),
        isDirty: true,
      };

    case 'REMOVE_NODE': {
      const removedId = action.payload;
      return {
        ...state,
        endpoints: state.endpoints.filter(ep => ep.id !== removedId),
        // Also remove connections to/from this node
        connections: state.connections.filter(
          c => c.from_endpoint_id !== removedId && c.to_endpoint_id !== removedId
        ),
        selection: state.selection.id === removedId ? { type: null, id: null } : state.selection,
        isDirty: true,
      };
    }

    case 'MOVE_NODE':
      return {
        ...state,
        endpoints: state.endpoints.map(ep =>
          ep.id === action.payload.id
            ? { ...ep, canvas_x: action.payload.x, canvas_y: action.payload.y }
            : ep
        ),
        isDirty: true,
      };

    case 'ADD_CONNECTION':
      return {
        ...state,
        connections: [...state.connections, action.payload],
        isDirty: true,
      };

    case 'UPDATE_CONNECTION':
      return {
        ...state,
        connections: state.connections.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.changes } : c
        ),
        isDirty: true,
      };

    case 'REMOVE_CONNECTION':
      return {
        ...state,
        connections: state.connections.filter(c => c.id !== action.payload),
        selection: state.selection.id === action.payload ? { type: null, id: null } : state.selection,
        isDirty: true,
      };

    case 'ADD_SECTION':
      return {
        ...state,
        sections: [...state.sections, action.payload],
        isDirty: true,
      };

    case 'UPDATE_SECTION':
      return {
        ...state,
        sections: state.sections.map(s =>
          s.id === action.payload.id ? { ...s, ...action.payload.changes } : s
        ),
        isDirty: true,
      };

    case 'REMOVE_SECTION': {
      const sectionId = action.payload;
      return {
        ...state,
        sections: state.sections.filter(s => s.id !== sectionId),
        // Unassign endpoints from removed section
        endpoints: state.endpoints.map(ep =>
          ep.section_id === sectionId ? { ...ep, section_id: null } : ep
        ),
        isDirty: true,
      };
    }

    case 'SET_VIEWPORT':
      return { ...state, viewport: action.payload };

    case 'SELECT':
      return { ...state, selection: action.payload };

    case 'SET_MODE':
      return {
        ...state,
        mode: action.payload,
        drawWire: action.payload !== 'draw_wire' ? null : state.drawWire,
      };

    case 'SET_DRAW_WIRE':
      return { ...state, drawWire: action.payload };

    case 'UPDATE_DESIGN':
      return {
        ...state,
        design: state.design ? { ...state.design, ...action.payload } : null,
        isDirty: true,
      };

    default:
      return state;
  }
}

export function useHarnessState() {
  const [state, dispatch] = useReducer(harnessReducer, initialState);

  const setDesign = useCallback((
    design: HarnessDesign,
    sections: HarnessSection[],
    endpoints: HarnessEndpoint[],
    connections: WiringConnection[]
  ) => {
    dispatch({ type: 'SET_DESIGN', payload: { design, sections, endpoints, connections } });
  }, []);

  const addNode = useCallback((endpoint: HarnessEndpoint) => {
    dispatch({ type: 'ADD_NODE', payload: endpoint });
  }, []);

  const updateNode = useCallback((id: string, changes: Partial<HarnessEndpoint>) => {
    dispatch({ type: 'UPDATE_NODE', payload: { id, changes } });
  }, []);

  const removeNode = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_NODE', payload: id });
  }, []);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    dispatch({ type: 'MOVE_NODE', payload: { id, x, y } });
  }, []);

  const addConnection = useCallback((connection: WiringConnection) => {
    dispatch({ type: 'ADD_CONNECTION', payload: connection });
  }, []);

  const updateConnection = useCallback((id: string, changes: Partial<WiringConnection>) => {
    dispatch({ type: 'UPDATE_CONNECTION', payload: { id, changes } });
  }, []);

  const removeConnection = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_CONNECTION', payload: id });
  }, []);

  const addSection = useCallback((section: HarnessSection) => {
    dispatch({ type: 'ADD_SECTION', payload: section });
  }, []);

  const select = useCallback((selection: HarnessSelection) => {
    dispatch({ type: 'SELECT', payload: selection });
  }, []);

  const setMode = useCallback((mode: CanvasMode) => {
    dispatch({ type: 'SET_MODE', payload: mode });
  }, []);

  const setDrawWire = useCallback((dw: DrawWireState | null) => {
    dispatch({ type: 'SET_DRAW_WIRE', payload: dw });
  }, []);

  const setViewport = useCallback((vp: { x: number; y: number; zoom: number }) => {
    dispatch({ type: 'SET_VIEWPORT', payload: vp });
  }, []);

  return {
    state,
    dispatch,
    setDesign,
    addNode,
    updateNode,
    removeNode,
    moveNode,
    addConnection,
    updateConnection,
    removeConnection,
    addSection,
    select,
    setMode,
    setDrawWire,
    setViewport,
  };
}
