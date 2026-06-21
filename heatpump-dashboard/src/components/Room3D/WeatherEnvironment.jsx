import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROOM_LAYOUT } from "./LectureRoom";

const SCENE_SCALE = 0.68;
const SCENE_OFFSET_X = 0.2;

const SKY_RADIUS = 14;
const RAIN_SPAWN_Y = 10.5;
const RAIN_GROUND_Y = -0.2;
const RAIN_COLUMNS = 16;
const RAIN_ROWS = 16;
const RAIN_COUNT = RAIN_COLUMNS * RAIN_ROWS;

function worldFromRoom(x, y, z) {
  return [SCENE_OFFSET_X + x * SCENE_SCALE, y * SCENE_SCALE, z * SCENE_SCALE];
}

function isInsideRoomEnvelope(wx, wy, wz) {
  const { halfW, frontZ, backZ, ridgeY } = ROOM_LAYOUT;
  const [xMin] = worldFromRoom(-halfW - 0.05, 0, 0);
  const [xMax] = worldFromRoom(halfW + 0.05, 0, 0);
  const [, , zMin] = worldFromRoom(0, 0, backZ - 0.05);
  const [, , zMax] = worldFromRoom(0, 0, frontZ + 0.05);
  const [, yMax] = worldFromRoom(0, ridgeY + 0.05, 0);

  return wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax && wy >= -0.05 && wy <= yMax;
}

function RainField() {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const drops = useMemo(() => {
    const span = SKY_RADIUS * 1.85;
    const result = [];

    for (let index = 0; index < RAIN_COUNT; index += 1) {
      const col = index % RAIN_COLUMNS;
      const row = Math.floor(index / RAIN_COLUMNS);
      const x = -span / 2 + (col / Math.max(RAIN_COLUMNS - 1, 1)) * span + (row % 3) * 0.08;
      const z = -span / 2 + (row / Math.max(RAIN_ROWS - 1, 1)) * span + (col % 3) * 0.08;
      result.push({
        x,
        z,
        speed: 2.4 + (index % 7) * 0.35,
        phase: index * 0.41,
      });
    }

    return result;
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.02, 0.2, 0.02);
    geo.translate(0, -0.1, 0);
    return geo;
  }, []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const elapsed = clock.getElapsedTime();

    drops.forEach((drop, index) => {
      const fallSpan = RAIN_SPAWN_Y - RAIN_GROUND_Y;
      const t = (elapsed * drop.speed + drop.phase) % fallSpan;
      let y = RAIN_SPAWN_Y - t;
      const x = drop.x + Math.sin(elapsed * 0.6 + drop.phase) * 0.04;
      const z = drop.z + Math.cos(elapsed * 0.55 + drop.phase) * 0.04;

      if (y < RAIN_GROUND_Y) {
        y = RAIN_SPAWN_Y + (drop.phase % 0.8);
      }

      dummy.position.set(x, y, z);
      dummy.scale.set(
        isInsideRoomEnvelope(x, y, z) ? 0 : 1,
        isInsideRoomEnvelope(x, y, z) ? 0 : 1,
        isInsideRoomEnvelope(x, y, z) ? 0 : 1,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, RAIN_COUNT]} frustumCulled={false}>
      <meshStandardMaterial color="#93c5fd" transparent opacity={0.55} />
    </instancedMesh>
  );
}

function SnowField() {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flakes = useMemo(() => {
    const span = SKY_RADIUS * 1.85;
    const result = [];

    for (let index = 0; index < RAIN_COUNT; index += 1) {
      const col = index % RAIN_COLUMNS;
      const row = Math.floor(index / RAIN_COLUMNS);
      const x = -span / 2 + (col / Math.max(RAIN_COLUMNS - 1, 1)) * span + (row % 3) * 0.08;
      const z = -span / 2 + (row / Math.max(RAIN_ROWS - 1, 1)) * span + (col % 3) * 0.08;
      result.push({
        x,
        z,
        speed: 0.55 + (index % 7) * 0.08,
        phase: index * 0.41,
      });
    }

    return result;
  }, []);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.05, 8, 8), []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const elapsed = clock.getElapsedTime();

    flakes.forEach((flake, index) => {
      const fallSpan = RAIN_SPAWN_Y - RAIN_GROUND_Y;
      const t = (elapsed * flake.speed + flake.phase) % fallSpan;
      let y = RAIN_SPAWN_Y - t;
      const x = flake.x + Math.sin(elapsed * 0.6 + flake.phase) * 0.04;
      const z = flake.z + Math.cos(elapsed * 0.55 + flake.phase) * 0.04;

      if (y < RAIN_GROUND_Y) {
        y = RAIN_SPAWN_Y + (flake.phase % 0.8);
      }

      dummy.position.set(x, y, z);
      dummy.scale.set(
        isInsideRoomEnvelope(x, y, z) ? 0 : 1,
        isInsideRoomEnvelope(x, y, z) ? 0 : 1,
        isInsideRoomEnvelope(x, y, z) ? 0 : 1,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, RAIN_COUNT]} frustumCulled={false}>
      <meshStandardMaterial color="#f8fafc" />
    </instancedMesh>
  );
}

export default function WeatherEnvironment({ weather }) {
  const { condition, isDay, cloudCover } = weather ?? {
    condition: "cloudy",
    isDay: true,
    cloudCover: 50,
  };

  const showRain = condition === "rain";
  const showSnow = condition === "snow";
  const showClouds = condition === "cloudy" || condition === "fog" || showRain || showSnow;
  const sunColor = isDay ? "#fde68a" : "#e2e8f0";
  const skyColor = isDay ? "#7dd3fc" : "#0f172a";

  const sunPosition = isDay ? [0.8, 9.2, -1.2] : [-1.5, 9.0, 1.2];
  const cloudPositions = [
    [0.5, 7.2, -0.8],
    [-1.5, 7.5, 0.6],
    [1.8, 7.0, 0.4],
    [-3.2, 7.3, -2.5],
    [3.5, 7.1, 2.2],
  ];

  return (
    <group>
      <mesh position={[0, 2.2, 0]}>
        <sphereGeometry args={[SKY_RADIUS, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2.05]} />
        <meshBasicMaterial color={skyColor} side={THREE.BackSide} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <circleGeometry args={[SKY_RADIUS, 48]} />
        <meshStandardMaterial color={isDay ? "#86efac" : "#14532d"} roughness={0.9} />
      </mesh>

      {showClouds &&
        cloudPositions.map((pos, index) => (
          <group key={index} position={pos}>
            <mesh>
              <sphereGeometry args={[0.65 + cloudCover / 180, 12, 12]} />
              <meshStandardMaterial color="#f8fafc" transparent opacity={0.84} />
            </mesh>
            <mesh position={[0.45, -0.08, 0.1]}>
              <sphereGeometry args={[0.48 + cloudCover / 220, 12, 12]} />
              <meshStandardMaterial color="#e2e8f0" transparent opacity={0.8} />
            </mesh>
            <mesh position={[-0.42, -0.05, -0.08]}>
              <sphereGeometry args={[0.4 + cloudCover / 240, 12, 12]} />
              <meshStandardMaterial color="#f1f5f9" transparent opacity={0.78} />
            </mesh>
          </group>
        ))}

      <mesh position={sunPosition}>
        <sphereGeometry args={[isDay ? 0.75 : 0.55, 24, 24]} />
        <meshStandardMaterial
          color={sunColor}
          emissive={sunColor}
          emissiveIntensity={isDay ? 0.95 : 0.45}
        />
      </mesh>

      {showRain && <RainField />}

      {showSnow && <SnowField />}
    </group>
  );
}
