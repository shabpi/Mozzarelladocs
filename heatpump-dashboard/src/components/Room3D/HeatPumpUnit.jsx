import { Html } from "@react-three/drei";

export default function HeatPumpUnit({ heatingOn, powerKw }) {
  const bodyColor = heatingOn ? "#f97316" : "#94a3b8";
  const glow = heatingOn ? 0.45 : 0;

  return (
    <group position={[-2.5, 0.45, 2.1]} rotation={[0, Math.PI / 6, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.15, 0.75, 0.42]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={heatingOn ? "#ea580c" : "#000000"}
          emissiveIntensity={glow}
          metalness={0.25}
          roughness={0.55}
        />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.95, 0.12, 0.34]} />
        <meshStandardMaterial color="#334155" metalness={0.4} roughness={0.4} />
      </mesh>

      <Html
        center
        distanceFactor={14}
        position={[0, -0.75, 0]}
        style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
      >
        <div className="rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white shadow-lg">
          {heatingOn ? "Heating ON" : "Heating OFF"}
          {powerKw != null ? ` · ${powerKw.toFixed(1)} kW` : ""}
        </div>
      </Html>
    </group>
  );
}
