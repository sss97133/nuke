// @types/react 19 reads intrinsic elements from React.JSX; @react-three/fiber 8 only augments the global JSX namespace.
import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
