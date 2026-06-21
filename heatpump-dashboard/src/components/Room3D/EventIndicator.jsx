import { Html } from "@react-three/drei";

export default function EventIndicator({ active, eventName }) {
  if (!active) return null;

  return (
    <>
      <mesh position={[0, 5.15, -1.8]}>
        <boxGeometry args={[3.2, 0.08, 0.08]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.8} />
      </mesh>

      <Html
        position={[0, 5.45, -1.8]}
        center
        distanceFactor={14}
        style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
      >
        <div className="rounded-lg border-2 border-amber-400 bg-amber-500/90 px-4 py-2 text-sm font-semibold text-black shadow-lg">
          Event in progress
          {eventName ? ` · ${eventName}` : ""}
        </div>
      </Html>
    </>
  );
}
