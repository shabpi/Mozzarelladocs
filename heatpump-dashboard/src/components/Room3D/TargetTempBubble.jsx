import { Html } from "@react-three/drei";
import { tempToColor } from "../../utils/room3dUtils";

export default function TargetTempBubble({
  targetTemp,
  insideTemp,
  targetIsStandby = false,
  position = [1.4, 2.05, 1.65],
  labelOffset = [0, 0.55, 0],
}) {
  const accent = tempToColor(insideTemp, targetTemp);

  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color="#0b75b7" emissive="#0b75b7" emissiveIntensity={0.35} />
      </mesh>

      <Html
        center
        distanceFactor={13}
        position={labelOffset}
        style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
      >
        <div
          className="rounded-xl border-2 bg-black/80 px-4 py-2 text-sm font-semibold text-white shadow-xl"
          style={{ borderColor: accent }}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-sky-200">
            Target temperature
          </p>
          <p className="text-lg" style={{ color: accent }}>
            {targetTemp?.toFixed?.(1) ?? "—"}°C
          </p>
          {targetIsStandby && (
            <p className="text-[10px] font-normal text-amber-200">Energy-saving standby</p>
          )}
        </div>
      </Html>
    </group>
  );
}
