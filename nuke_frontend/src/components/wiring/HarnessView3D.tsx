// HarnessView3D.tsx — Three.js / React Three Fiber 3D harness view
// Transparent K5 shell, zone volumes, harness trunks as 3D tubes,
// OrbitControls. Click connector → detail panel.

import React, { useMemo, useRef, useState, useCallback, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { ManifestDevice, OverlayResult } from './overlayCompute';
import { K5_HARNESS_GRAPH, routeWiresAlongHarness, computeTrunkSegments } from './harnessRouting';
import type { TrunkRenderSegment } from './harnessRouting';

// ── K5 Blazer dimensions (inches) ────────────────────────────────────
const K5_L = 184.8;
const K5_W = 79.6;
const K5_H = 73;

// Scale factor: 3D units = inches / 10
const S = 0.1;

// Zone volumes (approximate regions in 3D space)
const ZONES: Record<string, { position: [number, number, number]; size: [number, number, number]; color: string }> = {
  engine_bay: { position: [7, 1.5, 0], size: [4, 3, 6], color: '#cc2222' },
  firewall:   { position: [4.5, 2, 0], size: [0.5, 4, 7], color: '#cc6600' },
  dash:       { position: [2.5, 2.5, 0], size: [3, 2.5, 7], color: '#2266cc' },
  doors:      { position: [2, 1.5, 0], size: [3, 3, 0.5], color: '#8822cc' },
  rear:       { position: [-4, 1, 0], size: [6, 3, 6], color: '#22aa44' },
  underbody:  { position: [0, -0.5, 0], size: [16, 0.5, 6], color: '#666666' },
};

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222',
  firewall: '#cc6600',
  dash: '#2266cc',
  doors: '#8822cc',
  rear: '#22aa44',
  underbody: '#666666',
};

interface Props {
  devices: ManifestDevice[];
  result: OverlayResult;
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  onDeviceClick: (id: string, shiftKey?: boolean) => void;
  onWireClick: (wireNumber: number) => void;
  onDeselect: () => void;
  fitRequested: number;
  zoneColors: Record<string, string>;
}

// Map 1000×1000 canvas space to 3D coordinates
// Canvas: x=0..1000 (left to right), y=0..1000 (top to bottom)
// 3D: x = front-to-rear of vehicle, y = height, z = left-to-right
function canvasTo3D(cx: number, cy: number): [number, number, number] {
  const x = ((1000 - cy) / 1000) * K5_L * S - K5_L * S / 2; // cy maps to vehicle length
  const z = (cx / 1000) * K5_W * S - K5_W * S / 2; // cx maps to vehicle width
  const y = 2; // default height at mid-vehicle
  return [x, y, z];
}

export function HarnessView3D({
  devices, result, selectedDeviceId, selectedWireId,
  onDeviceClick, onDeselect,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  // ── Compute trunk segments for rendering ──
  const trunkSegments = useMemo((): TrunkRenderSegment[] => {
    const requests = result.wires.map(w => {
      const fromDev = devices.find(d => d.device_name === w.from.split(':')[0]);
      const toDev = devices.find(d => d.device_name === w.to);
      return {
        wireNumber: w.wireNumber,
        fromX: (fromDev?.pos_x_pct ?? 50) * 5,
        fromY: (fromDev?.pos_y_pct ?? 50) * 5,
        toX: (toDev?.pos_x_pct ?? 50) * 5,
        toY: (toDev?.pos_y_pct ?? 50) * 5,
      };
    });
    const routed = routeWiresAlongHarness(requests);
    return computeTrunkSegments(routed);
  }, [devices, result.wires]);

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a18' }}>
      <Canvas
        camera={{ position: [32, 18, 32], fov: 45, near: 0.1, far: 500 }}
        style={{ background: '#0a0a18' }}
        onClick={(e) => {
          // Click on empty space = deselect
          if ((e.target as HTMLElement).tagName === 'CANVAS') {
            // Only deselect if nothing was hit (handled by mesh click stopPropagation)
          }
        }}
      >
        <ambientLight intensity={1.2} />
        <hemisphereLight args={["#ffffff", "#404060", 0.8]} />
        <directionalLight position={[20, 25, 15]} intensity={2.2} />
        <directionalLight position={[-18, 12, -12]} intensity={1.2} />
        <directionalLight position={[0, 20, -20]} intensity={0.8} />
        <pointLight position={[0, 10, 0]} intensity={0.6} />

        {/* Controls */}
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          minDistance={3}
          maxDistance={150}
        />

        {/* Ground grid */}
        <gridHelper args={[30, 30, '#222244', '#161630']} position={[0, -1, 0]} />

        {/* K5 shell — loads GLB inside Suspense so the rest of the scene mounts */}
        <Suspense fallback={null}>
          <VehicleShell />
        </Suspense>

        {/* Zone volumes */}
        {Object.entries(ZONES).map(([zoneId, zone]) => (
          <ZoneVolume key={zoneId} {...zone} label={zoneId.replace(/_/g, ' ').toUpperCase()} />
        ))}

        {/* Harness trunks */}
        {trunkSegments.map((seg, i) => (
          <HarnessTube key={i} segment={seg} />
        ))}

        {/* Device connectors */}
        {devices.map(d => {
          if (d.pos_x_pct == null || d.pos_y_pct == null) return null;
          const pos = canvasTo3D(d.pos_x_pct * 5, d.pos_y_pct * 5);
          const isSelected = d.id === selectedDeviceId;
          const isHovered = d.id === hovered;
          const zoneColor = ZONE_COLORS[d.location_zone || ''] || '#666';

          return (
            <group key={d.id} position={pos}>
              <mesh
                onClick={(e: ThreeEvent<MouseEvent>) => {
                  e.stopPropagation();
                  onDeviceClick(d.id, e.nativeEvent.shiftKey);
                }}
                onPointerOver={() => setHovered(d.id)}
                onPointerOut={() => setHovered(null)}
              >
                <boxGeometry args={[0.4, 0.3, 0.3]} />
                <meshStandardMaterial
                  color={isSelected ? '#00ddff' : isHovered ? '#00ddff' : zoneColor}
                  transparent
                  opacity={isSelected ? 1 : isHovered ? 0.9 : 0.7}
                  emissive={isSelected ? '#00ddff' : '#000000'}
                  emissiveIntensity={isSelected ? 0.5 : 0}
                />
              </mesh>
              {/* Label */}
              {(isSelected || isHovered) && (
                <Text
                  position={[0, 0.5, 0]}
                  fontSize={0.2}
                  color={isSelected ? '#00ddff' : '#e0e0e8'}
                  anchorX="center"
                  anchorY="bottom"
                  font={undefined}
                >
                  {d.device_name}
                </Text>
              )}
            </group>
          );
        })}

        {/* Junction nodes from harness graph */}
        {K5_HARNESS_GRAPH.nodes.map(node => {
          const pos = canvasTo3D(node.x, node.y);
          return (
            <mesh key={node.id} position={pos}>
              <sphereGeometry args={[0.1, 8, 8]} />
              <meshStandardMaterial color="#333355" transparent opacity={0.4} />
            </mesh>
          );
        })}
      </Canvas>

      {/* HUD overlay */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700,
        color: '#666680',
      }}>
        ORBIT=DRAG  ZOOM=SCROLL  PAN=RIGHT-DRAG  CLICK=SELECT
      </div>
    </div>
  );
}

// ── Vehicle shell ─────────────────────────────────────────────────────
// Loads the 1978 Blazer GLB (53 named meshes, no textures) and paints
// material slots with the vehicle's actual color combo.
const K5_MODEL_URL = '/models/k5-blazer.glb';

// Maroon body, tan/tartan interior — driven by vehicles.color for e08bf694.
// Keys are case-insensitive substrings of Blender material names.
interface MatRule {
  match: RegExp;
  color: string;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
}

const MATERIAL_OVERRIDES: MatRule[] = [
  // Maroon automotive paint — clearcoat for that wet candy look
  { match: /car_paint/i,           color: '#6b1f1f', metalness: 0.85, roughness: 0.25, clearcoat: 1.0, clearcoatRoughness: 0.05 },
  { match: /window_glass|^glass/i, color: '#1a1f25', metalness: 0,    roughness: 0.02, opacity: 0.3, transparent: true },
  // Chrome must be near-zero roughness for reflections to read
  { match: /chrome/i,              color: '#e4e6ea', metalness: 1.0,  roughness: 0.08 },
  { match: /wheel_tire|^rubber\b|tire/i, color: '#161616', metalness: 0, roughness: 0.95 },
  { match: /plaid/i,               color: '#8b6535', metalness: 0, roughness: 0.85 },
  { match: /leather|seat_belt/i,   color: '#c4a984', metalness: 0, roughness: 0.65 },
  { match: /carpet/i,              color: '#3e2f22', metalness: 0, roughness: 1.0 },
  { match: /dashboard_plastic|plastic_black|metal_black|undercarriage/i, color: '#1a1b1f', metalness: 0.2, roughness: 0.55 },
  { match: /headlight/i,           color: '#f5f5f7', metalness: 0.1, roughness: 0.15, emissive: '#fff8dc', emissiveIntensity: 0.4 },
  { match: /tail_light/i,          color: '#a01818', metalness: 0.1, roughness: 0.2,  emissive: '#a01818', emissiveIntensity: 0.5 },
];

useGLTF.preload(K5_MODEL_URL);

function VehicleShell() {
  const { scene } = useGLTF(K5_MODEL_URL);

  // Clone so material overrides don't leak across instances
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = mats.map((m) => {
        if (!m) return m;
        const name = (m.name || '').toLowerCase();
        const rule = MATERIAL_OVERRIDES.find((r) => r.match.test(name));
        const std = new THREE.MeshStandardMaterial({
          color: rule?.color ?? '#888888',
          metalness: rule?.metalness ?? 0.1,
          roughness: rule?.roughness ?? 0.6,
          transparent: rule?.transparent ?? false,
          opacity: rule?.opacity ?? 1,
          emissive: rule?.emissive ? new THREE.Color(rule.emissive) : new THREE.Color(0x000000),
          emissiveIntensity: rule?.emissiveIntensity ?? 0,
          envMapIntensity: 1.0,
          side: THREE.FrontSide,
        });
        std.name = m.name;
        return std;
      }) as THREE.Material[] | THREE.Material;
      if (Array.isArray(mesh.material) && mesh.material.length === 1) {
        mesh.material = mesh.material[0];
      }
    });
  }, [cloned]);

  // The Blender export is in meters (Y-up). The scene uses inches/10.
  // Blazer length ≈ 4.69m → 18.48 scene units (K5_L * S). Ratio ≈ 3.94.
  // Compute scale from the model bounding box so it always matches K5_L.
  const { scale, offset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    // The longest horizontal axis is the vehicle length
    const longest = Math.max(size.x, size.z);
    const k5LenUnits = K5_L * S;
    const s = longest > 0 ? k5LenUnits / longest : 1;
    return { scale: s, offset: center.multiplyScalar(s).negate() };
  }, [cloned]);

  // Model from Blender export has +Z forward. Our scene has +X forward.
  // Rotate -90° around Y to align.
  return (
    <group rotation={[0, -Math.PI / 2, 0]}>
      <primitive object={cloned} scale={scale} position={offset} />
    </group>
  );
}

// ── Zone volume ─────────────────────────────────────────────────────
function ZoneVolume({ position, size, color, label }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  label: string;
}) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.06}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
        <lineBasicMaterial color={color} transparent opacity={0.2} />
      </lineSegments>
      <Text
        position={[0, size[1] / 2 + 0.2, 0]}
        fontSize={0.25}
        color={color}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {label}
      </Text>
    </group>
  );
}

// ── Harness tube ─────────────────────────────────────────────────────
function HarnessTube({ segment }: { segment: TrunkRenderSegment }) {
  const geometry = useMemo(() => {
    const start = canvasTo3D(segment.x1, segment.y1);
    const end = canvasTo3D(segment.x2, segment.y2);
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(...start),
      new THREE.Vector3(...end),
    );
    const radius = Math.max(0.05, Math.min(segment.wireCount * 0.03, 0.4));
    return new THREE.TubeGeometry(curve, 8, radius, 6, false);
  }, [segment]);

  const color = ZONE_COLORS[segment.zone] || '#555577';

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.6}
        roughness={0.3}
        metalness={0.2}
      />
    </mesh>
  );
}
