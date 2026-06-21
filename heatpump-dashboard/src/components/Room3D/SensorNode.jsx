import { Html } from "@react-three/drei";

export default function SensorNode({
  position,
  label,
  value,
  unit = "°C",
  accent = "#38bdf8",
  labelOffset = [0, 0.35, 0],
  showLabel = true,
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.14, 0.14, 0.08]} />
        <meshStandardMaterial color="#1e293b" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <sphereGeometry args={[0.05, 10, 10]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
      </mesh>

      {showLabel && (
        <Html
          center
          distanceFactor={14}
          position={labelOffset}
          style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
        >
          <div
            className="rounded-md border bg-black/75 px-2 py-1 text-[10px] text-white shadow-lg"
            style={{ borderColor: accent }}
          >
            <p className="font-medium text-white/90">{label}</p>
            <p style={{ color: accent }}>
              {value != null ? `${Number(value).toFixed(1)}${unit}` : "—"}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}
