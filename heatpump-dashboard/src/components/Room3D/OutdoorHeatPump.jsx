import { Html } from "@react-three/drei";

export default function OutdoorHeatPump({
  heatingOn,
  coolingOn,
  powerKw,
  position = [6.2, 0.45, 3.8],
  rotation = [0, -Math.PI / 4, 0],
  showLabel = true,
}) {
  const active = heatingOn || coolingOn;
  const bodyColor = heatingOn ? "#f97316" : coolingOn ? "#38bdf8" : "#94a3b8";
  const glow = active ? 0.5 : 0;
  const label = heatingOn ? "Heating" : coolingOn ? "Cooling" : "Standby";

  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.35, 0.9, 0.55]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={bodyColor}
          emissiveIntensity={glow}
          metalness={0.3}
          roughness={0.5}
        />
      </mesh>
      <mesh position={[0.55, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 12]} />
        <meshStandardMaterial color="#64748b" metalness={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[-0.55, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 12]} />
        <meshStandardMaterial color="#64748b" metalness={0.45} roughness={0.4} />
      </mesh>

      <Html
        center
        distanceFactor={14}
        position={[0, -0.85, 0]}
        style={{ pointerEvents: "none", whiteSpace: "nowrap", display: showLabel ? undefined : "none" }}
      >
        <div className="rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white shadow-lg">
          Heat pump · {label}
          {powerKw != null ? ` · ${powerKw.toFixed(1)} kW` : ""}
        </div>
      </Html>
    </group>
  );
}
