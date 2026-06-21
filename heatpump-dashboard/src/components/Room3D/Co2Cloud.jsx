import { Html } from "@react-three/drei";
import { co2ToColor, co2ToOpacity } from "../../utils/room3dUtils";

export default function Co2Cloud({ ppm, position = [-0.4, 1.6, -1.2], showLabel = true }) {
  if (ppm == null) return null;

  const color = co2ToColor(ppm);
  const opacity = co2ToOpacity(ppm);
  const scale = 0.8 + Math.min(ppm / 1800, 1) * 1.4;

  return (
    <group position={position}>
      <mesh scale={[scale, scale * 0.65, scale]}>
        <sphereGeometry args={[0.55, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.25}
          transparent
          opacity={opacity}
          depthWrite={false}
        />
      </mesh>

      {showLabel && (
        <Html
          center
          distanceFactor={16}
          position={[0, scale * 0.55, 0]}
          style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
        >
          <div
            className="rounded-md border bg-black/75 px-2 py-1 text-[10px] shadow-lg"
            style={{ borderColor: color, color }}
          >
            CO₂ {Math.round(ppm)} ppm
          </div>
        </Html>
      )}
    </group>
  );
}
