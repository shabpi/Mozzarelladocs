import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { airflowColor } from "../../utils/room3dUtils";
import { ROOM_LAYOUT } from "./LectureRoom";

function radialOffset(origin, t, theta, phi, spread) {
  const radius = t * spread;
  const sinPhi = Math.sin(phi);
  return [
    origin[0] + radius * sinPhi * Math.cos(theta),
    origin[1] - radius * Math.cos(phi),
    origin[2] + radius * sinPhi * Math.sin(theta),
  ];
}

function AirParticle({ index, origin, mode, ventIndex }) {
  const ref = useRef();
  const palette = airflowColor(mode);
  const theta = (index / 16) * Math.PI * 2 + ventIndex * 0.9;
  const phi = 0.35 + (index % 5) * 0.22;
  const spread = 2.15 + (ventIndex % 2) * 0.25;
  const phase = index * 0.19 + ventIndex * 0.41;
  const speed = 0.12 + (index % 4) * 0.025;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() * speed + phase) % 1;
    const [x, y, z] = radialOffset(origin, t, theta + t * 0.55, phi, spread);
    ref.current.position.set(x, y, z);

    const size = 0.1 + t ** 1.25 * 2.1;
    ref.current.scale.set(size, size, size);

    const material = ref.current.material;
    if (material) {
      material.opacity = Math.max(0.06, 0.28 - t * 0.2 - (index % 3) * 0.03);
    }
  });

  return (
    <mesh ref={ref} position={origin}>
      <sphereGeometry args={[0.07, 10, 10]} />
      <meshStandardMaterial
        color={palette.color}
        emissive={palette.emissive}
        emissiveIntensity={0.32}
        transparent
        opacity={0.24}
      />
    </mesh>
  );
}

function VentEmitter({ origin, mode, ventIndex }) {
  const palette = airflowColor(mode);

  return (
    <group position={origin}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.22, 20]} />
        <meshStandardMaterial
          color={palette.color}
          emissive={palette.emissive}
          emissiveIntensity={0.28}
          transparent
          opacity={0.22}
          side={2}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial
          color={palette.color}
          emissive={palette.emissive}
          emissiveIntensity={0.22}
          transparent
          opacity={0.16}
        />
      </mesh>

      {Array.from({ length: 14 }, (_, index) => (
        <AirParticle
          key={index}
          index={index}
          origin={[0, 0, 0]}
          mode={mode}
          ventIndex={ventIndex}
        />
      ))}
    </group>
  );
}

export default function AirflowStream({
  mode,
  origins = ROOM_LAYOUT.ventPositions,
  active = true,
}) {
  if (!active || mode === "idle") return null;

  return (
    <group>
      {origins.map((origin, index) => (
        <VentEmitter key={origin.join("-")} origin={origin} mode={mode} ventIndex={index} />
      ))}
    </group>
  );
}
