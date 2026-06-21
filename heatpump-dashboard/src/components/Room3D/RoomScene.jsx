import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import LectureRoom, { ROOM_LAYOUT } from "./LectureRoom";
import WeatherEnvironment from "./WeatherEnvironment";
import AirflowStream from "./AirflowStream";
import Co2Cloud from "./Co2Cloud";
import OccupancyPeople from "./OccupancyPeople";
import OutdoorHeatPump from "./OutdoorHeatPump";
import { RoomSensors } from "./RoomSensors";
import RoomSceneHud from "./RoomSceneHud";
import { resolveHvacMode } from "../../utils/room3dUtils";

const SCENE_SCALE = 0.68;
const CAMERA_TARGET = [0, 1.05, -0.25];

function RoomContent({
  insideTemp,
  targetTemp,
  returnTemp,
  outsideTemp,
  co2Ppm,
  powerKw,
  weather,
  eventActive,
}) {
  const hvacMode = resolveHvacMode({ powerKw, insideTemp, targetTemp });
  const heatingOn = hvacMode === "heating";
  const coolingOn = hvacMode === "cooling";
  const skyIntensity = weather?.isDay ? 0.65 : 0.22;

  return (
    <>
      <color attach="background" args={["#0f172a"]} />
      <fog attach="fog" args={["#0f172a", 11, 24]} />
      <ambientLight intensity={skyIntensity} />
      <directionalLight
        castShadow
        intensity={weather?.isDay ? 1.2 : 0.35}
        position={weather?.isDay ? [5, 8, 2] : [-3, 5, 1]}
        color={weather?.isDay ? "#ffffff" : "#93c5fd"}
      />
      <pointLight intensity={0.28} position={[-2, 3.5, 1]} color="#38bdf8" />

      <group scale={SCENE_SCALE} position={[0.2, 0, 0]}>
        <LectureRoom insideTemp={insideTemp} targetTemp={targetTemp} />

        <RoomSensors
          insideTemp={insideTemp}
          returnTemp={returnTemp}
          outsideTemp={outsideTemp}
          showLabels={false}
        />

        <AirflowStream mode={hvacMode} active={hvacMode !== "idle"} />
        <Co2Cloud ppm={co2Ppm} position={[0, 1.05, -0.35]} showLabel={false} />
        <OccupancyPeople active={eventActive} />

        <OutdoorHeatPump
          heatingOn={heatingOn}
          coolingOn={coolingOn}
          powerKw={powerKw}
          position={ROOM_LAYOUT.heaterCorner}
          rotation={ROOM_LAYOUT.heaterRotation}
          showLabel={false}
        />

        <mesh
          position={[
            ROOM_LAYOUT.heaterCorner[0] - 0.85,
            0.32,
            ROOM_LAYOUT.heaterCorner[2] - 0.35,
          ]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.05, 0.05, 1.35, 10]} />
          <meshStandardMaterial color="#64748b" metalness={0.4} roughness={0.45} />
        </mesh>
      </group>

      <WeatherEnvironment weather={weather} />

      <OrbitControls
        enablePan={false}
        maxPolarAngle={Math.PI / 2.12}
        minPolarAngle={Math.PI / 5.5}
        minDistance={5.2}
        maxDistance={11}
        target={CAMERA_TARGET}
      />
    </>
  );
}

export default function RoomScene({
  insideTemp = 20,
  targetTemp = 21,
  returnTemp = 18,
  outsideTemp = 8,
  co2Ppm = null,
  powerKw = 0,
  weather = null,
  eventActive = false,
  eventName = "",
  targetIsStandby = false,
  hvacMode = "idle",
  className = "",
}) {
  const resolvedHvac =
    hvacMode === "idle"
      ? resolveHvacMode({ powerKw, insideTemp, targetTemp })
      : hvacMode;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[#0f172a] shadow-[var(--shadow-card)] ${className}`}
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
    >
      <RoomSceneHud
        insideTemp={insideTemp}
        targetTemp={targetTemp}
        targetIsStandby={targetIsStandby}
        returnTemp={returnTemp}
        outsideTemp={outsideTemp}
        co2Ppm={co2Ppm}
        hvacMode={resolvedHvac}
        powerKw={powerKw}
        eventActive={eventActive}
        eventName={eventName}
      />

      <Canvas
        className="h-full w-full"
        shadows
        camera={{ position: [7.2, 2.15, 0.55], fov: 52, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <RoomContent
            insideTemp={insideTemp}
            targetTemp={targetTemp}
            returnTemp={returnTemp}
            outsideTemp={outsideTemp}
            co2Ppm={co2Ppm}
            powerKw={powerKw}
            weather={weather}
            eventActive={eventActive}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
