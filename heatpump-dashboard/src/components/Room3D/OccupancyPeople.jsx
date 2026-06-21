import { ROOM_LAYOUT } from "./LectureRoom";

function Person({ position, rotation = 0 }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.32, 4, 8]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <sphereGeometry args={[0.11, 10, 10]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
    </group>
  );
}

function buildSeatPositions() {
  const seats = [];
  const { leftBlockX, rightBlockX, tiers } = ROOM_LAYOUT;
  const offsets = [-0.85, 0, 0.85];

  tiers.forEach((tier) => {
    offsets.forEach((ox) => {
      seats.push([leftBlockX + ox, tier.y + 0.38, tier.z]);
      seats.push([rightBlockX + ox, tier.y + 0.38, tier.z]);
    });
  });

  return seats;
}

const SEAT_POSITIONS = buildSeatPositions();

export default function OccupancyPeople({ active }) {
  if (!active) return null;

  return (
    <group>
      {SEAT_POSITIONS.map((position, index) => (
        <Person key={index} position={position} rotation={index % 2 === 0 ? Math.PI : 0} />
      ))}
    </group>
  );
}
