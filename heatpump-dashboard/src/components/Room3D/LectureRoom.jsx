import { useMemo } from "react";
import * as THREE from "three";
import { tempToColor, tempToHexOpacity } from "../../utils/room3dUtils";

const ROOM_W = 8;
const ROOM_D = 7;
const FRONT_Z = 3.35;
const BACK_Z = -3.35;
const HALF_W = ROOM_W / 2;
const EAVE_H = 3.12;
const RIDGE_Y = 4.08;
const WALL_T = 0.1;
const EXT_T = 0.1;
const EXTERIOR_BLUE = "#1e40af";
const INTERIOR_BEIGE = "#d6cbb8";
const ROOF_SLOPE = Math.atan2(RIDGE_Y - EAVE_H, HALF_W);

const TIERS = [
  { y: 0.14, z: 0.05, h: 0.26 },
  { y: 0.4, z: -0.65, h: 0.26 },
  { y: 0.66, z: -1.35, h: 0.26 },
  { y: 0.92, z: -2.05, h: 0.26 },
  { y: 1.18, z: -2.75, h: 0.26 },
];

const AISLE_HALF = 0.55;
const BLOCK_W = 2.85;

/** Ducts run front-to-back, suspended below the roof trusses */
const VENT_Y = 2.78;
const VENT_POSITIONS = [
  [-2.35, VENT_Y, 0],
  [-0.85, VENT_Y - 0.08, 0],
  [0.85, VENT_Y - 0.08, 0],
  [2.35, VENT_Y, 0],
];

function TierBlock({ x, y, z, height, depth = 0.52 }) {
  return (
    <mesh position={[x, y + height / 2, z]} receiveShadow castShadow>
      <boxGeometry args={[BLOCK_W, height, depth]} />
      <meshStandardMaterial color="#c9a66b" roughness={0.78} />
    </mesh>
  );
}

function VentDuct({ position, length = ROOM_D - 0.5 }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.15, 0.15, length, 16]} />
      <meshStandardMaterial color="#0b75b7" metalness={0.35} roughness={0.45} />
    </mesh>
  );
}

function CeilingTruss({ position, size }) {
  return (
    <mesh position={position} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#94a3b8" metalness={0.55} roughness={0.45} />
    </mesh>
  );
}

function SlopedGableFill({ xSign, material, thickness = WALL_T }) {
  const slopeLen = Math.hypot(HALF_W, RIDGE_Y - EAVE_H);
  const midX = (xSign * HALF_W) / 2;
  const midY = EAVE_H + (RIDGE_Y - EAVE_H) / 2;
  const rotation = xSign > 0 ? -ROOF_SLOPE : ROOF_SLOPE;

  return (
    <mesh position={[midX, midY, 0]} rotation={[0, 0, rotation]}>
      <boxGeometry args={[slopeLen, thickness, ROOM_D]} />
      <meshStandardMaterial {...material} />
    </mesh>
  );
}

/** Interior comfort overlay on the left wall (-X), flush inside the envelope only. */
function ComfortHeatmapWall({ insideTemp, targetTemp }) {
  const wallColor = tempToColor(insideTemp, targetTemp);
  const wallOpacity = tempToHexOpacity(insideTemp, targetTemp);
  const inset = 0.12;
  const x = -HALF_W + WALL_T + 0.006;

  const panelMat = {
    color: wallColor,
    transparent: true,
    opacity: wallOpacity,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  };

  return (
    <mesh position={[x, EAVE_H / 2, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={1}>
      <planeGeometry args={[ROOM_D - inset * 2, EAVE_H - inset]} />
      <meshStandardMaterial {...panelMat} />
    </mesh>
  );
}

function EndGableTriangle({ z, material, isExterior = false, faceInward = false }) {
  const geometry = useMemo(() => {
    const zPos = z + (isExterior ? (z > 0 ? EXT_T / 2 : -EXT_T / 2) : 0);
    const verts = faceInward
      ? z > 0
        ? new Float32Array([
            -HALF_W, EAVE_H, zPos,
            0, RIDGE_Y, zPos,
            HALF_W, EAVE_H, zPos,
          ])
        : new Float32Array([
            HALF_W, EAVE_H, zPos,
            0, RIDGE_Y, zPos,
            -HALF_W, EAVE_H, zPos,
          ])
      : new Float32Array([
          -HALF_W, EAVE_H, zPos,
          HALF_W, EAVE_H, zPos,
          0, RIDGE_Y, zPos,
        ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }, [z, isExterior, faceInward]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        {...material}
        side={faceInward ? THREE.FrontSide : THREE.DoubleSide}
      />
    </mesh>
  );
}

function ExteriorRoofPanel({ xSign }) {
  const slopeLen = HALF_W / Math.cos(ROOF_SLOPE) + 0.06;
  const midX = (xSign * HALF_W) / 2;
  const midY = EAVE_H + (RIDGE_Y - EAVE_H) / 2;
  const rotation = xSign > 0 ? -ROOF_SLOPE : ROOF_SLOPE;
  const offsetX = xSign * 0.04;

  return (
    <mesh position={[midX + offsetX, midY, 0]} rotation={[0, 0, rotation]}>
      <boxGeometry args={[slopeLen, 0.09, ROOM_D + EXT_T * 2]} />
      <meshStandardMaterial color={EXTERIOR_BLUE} roughness={0.55} metalness={0.08} />
    </mesh>
  );
}

function PyramidCeiling() {
  const slopeLen = HALF_W / Math.cos(ROOF_SLOPE) + 0.05;

  return (
    <group renderOrder={2}>
      <mesh position={[-HALF_W / 2, EAVE_H + (RIDGE_Y - EAVE_H) / 2, 0]} rotation={[0, 0, ROOF_SLOPE]}>
        <boxGeometry args={[slopeLen, 0.07, ROOM_D]} />
        <meshStandardMaterial color="#64748b" metalness={0.45} roughness={0.55} />
      </mesh>
      <mesh position={[HALF_W / 2, EAVE_H + (RIDGE_Y - EAVE_H) / 2, 0]} rotation={[0, 0, -ROOF_SLOPE]}>
        <boxGeometry args={[slopeLen, 0.07, ROOM_D]} />
        <meshStandardMaterial color="#64748b" metalness={0.45} roughness={0.55} />
      </mesh>

      <CeilingTruss position={[0, RIDGE_Y, 0]} size={[0.1, 0.12, ROOM_D]} />

      {[-2.4, -0.8, 0.8, 2.4].map((x) => (
        <group key={x}>
          <CeilingTruss position={[x, RIDGE_Y - 0.35, -2.2]} size={[0.05, 0.05, 1.0]} />
          <CeilingTruss position={[x, EAVE_H + 0.35, -0.8]} size={[0.05, 0.05, 1.0]} />
          <CeilingTruss position={[x, RIDGE_Y - 0.35, 0.6]} size={[0.05, 0.05, 1.0]} />
          <CeilingTruss position={[x, EAVE_H + 0.35, 2.0]} size={[0.05, 0.05, 1.0]} />
        </group>
      ))}
    </group>
  );
}

function BuildingEnvelope({ openViewSide = true }) {
  const extMat = { color: EXTERIOR_BLUE, roughness: 0.55, metalness: 0.08 };
  const intMat = { color: INTERIOR_BEIGE, roughness: 0.85 };

  return (
    <group>
      {/* Front & back — rectangular pair + gable triangles at eave */}
      <mesh position={[0, EAVE_H / 2, FRONT_Z + EXT_T / 2]}>
        <boxGeometry args={[ROOM_W + EXT_T * 2, EAVE_H, EXT_T]} />
        <meshStandardMaterial {...extMat} />
      </mesh>
      <EndGableTriangle z={FRONT_Z} material={extMat} isExterior />
      <mesh position={[0, EAVE_H / 2, FRONT_Z - WALL_T / 2]}>
        <boxGeometry args={[ROOM_W, EAVE_H, WALL_T]} />
        <meshStandardMaterial {...intMat} />
      </mesh>
      <EndGableTriangle z={FRONT_Z - WALL_T / 2} material={intMat} faceInward />

      <mesh position={[0, EAVE_H / 2, BACK_Z - EXT_T / 2]}>
        <boxGeometry args={[ROOM_W + EXT_T * 2, EAVE_H, EXT_T]} />
        <meshStandardMaterial {...extMat} />
      </mesh>
      <EndGableTriangle z={BACK_Z} material={extMat} isExterior />
      <mesh position={[0, EAVE_H / 2, BACK_Z + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W, EAVE_H, WALL_T]} />
        <meshStandardMaterial {...intMat} />
      </mesh>
      <EndGableTriangle z={BACK_Z + WALL_T / 2} material={intMat} faceInward />

      {/* Left & right — rectangular pair + sloped fill under roof pitch */}
      <mesh position={[-HALF_W - EXT_T / 2, EAVE_H / 2, 0]}>
        <boxGeometry args={[EXT_T, EAVE_H, ROOM_D]} />
        <meshStandardMaterial {...extMat} />
      </mesh>
      <mesh position={[-HALF_W + WALL_T / 2, EAVE_H / 2, 0]}>
        <boxGeometry args={[WALL_T, EAVE_H, ROOM_D]} />
        <meshStandardMaterial {...intMat} />
      </mesh>
      <SlopedGableFill xSign={-1} material={extMat} thickness={EXT_T} />
      <SlopedGableFill xSign={-1} material={intMat} thickness={WALL_T} />

      {/* Right — closed exterior; interior open when viewing from +X */}
      {!openViewSide && (
        <>
          <mesh position={[HALF_W + EXT_T / 2, EAVE_H / 2, 0]}>
            <boxGeometry args={[EXT_T, EAVE_H, ROOM_D]} />
            <meshStandardMaterial {...extMat} />
          </mesh>
          <mesh position={[HALF_W - WALL_T / 2, EAVE_H / 2, 0]}>
            <boxGeometry args={[WALL_T, EAVE_H, ROOM_D]} />
            <meshStandardMaterial {...intMat} />
          </mesh>
        </>
      )}
      {openViewSide && (
        <>
          {/* Corner posts only — keeps outline without blocking view */}
          <mesh position={[HALF_W + EXT_T / 2, EAVE_H / 2, FRONT_Z - 0.55]}>
            <boxGeometry args={[EXT_T, EAVE_H, 1.5]} />
            <meshStandardMaterial {...extMat} />
          </mesh>
          <mesh position={[HALF_W + EXT_T / 2, EAVE_H / 2, BACK_Z + 0.55]}>
            <boxGeometry args={[EXT_T, EAVE_H, 1.5]} />
            <meshStandardMaterial {...extMat} />
          </mesh>
        </>
      )}
      <SlopedGableFill xSign={1} material={extMat} thickness={EXT_T} />
      {!openViewSide && (
        <SlopedGableFill xSign={1} material={intMat} thickness={WALL_T} />
      )}

      <ExteriorRoofPanel xSign={-1} />
      <ExteriorRoofPanel xSign={1} />
    </group>
  );
}

export default function LectureRoom({ insideTemp, targetTemp }) {
  const leftBlockX = -(AISLE_HALF + BLOCK_W / 2);
  const rightBlockX = AISLE_HALF + BLOCK_W / 2;

  return (
    <group>
      <BuildingEnvelope openViewSide />

      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[ROOM_W, 0.1, ROOM_D]} />
        <meshStandardMaterial color="#52525b" roughness={0.35} metalness={0.15} />
      </mesh>

      <mesh position={[0, 0.01, 2.15]} receiveShadow>
        <boxGeometry args={[ROOM_W - 0.4, 0.04, 2.2]} />
        <meshStandardMaterial color="#71717a" roughness={0.4} />
      </mesh>

      {TIERS.map((tier) => (
        <group key={tier.z}>
          <TierBlock x={leftBlockX} y={tier.y} z={tier.z} height={tier.h} />
          <TierBlock x={rightBlockX} y={tier.y} z={tier.z} height={tier.h} />
          <mesh position={[leftBlockX, tier.y - tier.h / 2 - 0.02, tier.z]} receiveShadow>
            <boxGeometry args={[BLOCK_W + 0.05, 0.05, 0.56]} />
            <meshStandardMaterial color="#2563eb" roughness={0.6} />
          </mesh>
          <mesh position={[rightBlockX, tier.y - tier.h / 2 - 0.02, tier.z]} receiveShadow>
            <boxGeometry args={[BLOCK_W + 0.05, 0.05, 0.56]} />
            <meshStandardMaterial color="#2563eb" roughness={0.6} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 2.15, FRONT_Z - WALL_T - 0.02]}>
        <boxGeometry args={[5.2, 2.4, 0.04]} />
        <meshStandardMaterial color="#f8fafc" emissive="#ffffff" emissiveIntensity={0.1} />
      </mesh>

      <ComfortHeatmapWall insideTemp={insideTemp} targetTemp={targetTemp} />

      <mesh position={[-HALF_W + WALL_T + 0.02, 2.95, 0]}>
        <boxGeometry args={[0.03, 0.5, ROOM_D - 0.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.2} metalness={0.1} />
      </mesh>

      <PyramidCeiling />

      {VENT_POSITIONS.map((pos) => (
        <VentDuct key={pos.join("-")} position={pos} />
      ))}

      <mesh position={[0.8, 0.35, 2.55]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.7, 0.5]} />
        <meshStandardMaterial color="#f4f4f5" roughness={0.7} />
      </mesh>
    </group>
  );
}

export const ROOM_LAYOUT = {
  frontZ: FRONT_Z,
  backZ: BACK_Z,
  halfW: HALF_W,
  eaveH: EAVE_H,
  ridgeY: RIDGE_Y,
  aisleHalf: AISLE_HALF,
  blockW: BLOCK_W,
  leftBlockX: -(AISLE_HALF + BLOCK_W / 2),
  rightBlockX: AISLE_HALF + BLOCK_W / 2,
  tiers: TIERS,
  ventPositions: VENT_POSITIONS,
  primaryVent: [-0.85, VENT_Y - 0.08, 0],
  /** Front-right corner beside the +X opening — tucked aside for an unobstructed view in. */
  heaterCorner: [4.85, 0.45, 2.55],
  heaterRotation: [0, -Math.PI / 2, 0],
  openSide: "+x",
};
