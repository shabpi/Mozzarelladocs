import SensorNode from "./SensorNode";
import { ROOM_LAYOUT } from "./LectureRoom";

export default function SupplyVent({ position = ROOM_LAYOUT.primaryVent }) {
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.1, 16]} />
        <meshStandardMaterial color="#0b75b7" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, 0.1]}>
        <boxGeometry args={[0.28, 0.28, 0.05]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

export function RoomSensors({ insideTemp, returnTemp, outsideTemp, showLabels = false }) {
  return (
    <>
      <SupplyVent />
      <SensorNode
        position={[-0.85, ROOM_LAYOUT.eaveH - 0.35, -2.55]}
        label="Return sensor"
        value={returnTemp}
        accent="#f97316"
        showLabel={showLabels}
      />
      <SensorNode
        position={[0, 0.75, 0.15]}
        label="Room sensor"
        value={insideTemp}
        accent="#22c55e"
        showLabel={showLabels}
      />
      <SensorNode
        position={[-3.85, 0.85, 2.15]}
        label="Outside sensor"
        value={outsideTemp}
        accent="#38bdf8"
        showLabel={showLabels}
      />
    </>
  );
}
