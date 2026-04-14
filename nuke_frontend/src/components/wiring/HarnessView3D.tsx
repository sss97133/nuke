// HarnessView3D.tsx — Three.js / React Three Fiber 3D harness view
// Transparent K5 shell, zone volumes, harness trunks as 3D tubes,
// OrbitControls. Click connector → detail panel.

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
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
        camera={{ position: [15, 10, 15], fov: 45, near: 0.1, far: 200 }}
        style={{ background: '#0a0a18' }}
        onClick={(e) => {
          // Click on empty space = deselect
          if ((e.target as HTMLElement).tagName === 'CANVAS') {
            // Only deselect if nothing was hit (handled by mesh click stopPropagation)
          }
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 15, 10]} intensity={0.6} />
        <directionalLight position={[-10, 10, -5]} intensity={0.3} />

        {/* Controls */}
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          minDistance={3}
          maxDistance={50}
        />

        {/* Ground grid */}
        <gridHelper args={[30, 30, '#222244', '#161630']} position={[0, -1, 0]} />

        {/* K5 shell (transparent wireframe box) */}
        <VehicleShell />

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
function VehicleShell() {
  return (
    <mesh>
      <boxGeometry args={[K5_L * S, K5_H * S, K5_W * S]} />
      <meshStandardMaterial
        color="#2266cc"
        transparent
        opacity={0.04}
        wireframe
      />
    </mesh>
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
