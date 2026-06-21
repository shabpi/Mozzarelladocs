import { useId } from "react";
import { useXAxisScale, useYAxisScale } from "recharts";
import { COMFORT_TARGET_COLOR, deltaToColor } from "../utils/chartUtils";

export default function ComfortDeltaLayer({ data, showComfortOverlay }) {
  const xScale = useXAxisScale(0);
  const yScale = useYAxisScale("temp");
  const baseId = useId();

  if (!showComfortOverlay || !data?.length || !xScale || !yScale) {
    return null;
  }

  const segments = [];

  for (let index = 0; index < data.length - 1; index += 1) {
    const current = data[index];
    const next = data[index + 1];

    if (
      current.domainAnchor ||
      next.domainAnchor ||
      current.insideTemp == null ||
      current.targetTemp == null ||
      next.insideTemp == null ||
      next.targetTemp == null
    ) {
      continue;
    }

    const delta =
      (Math.abs(current.insideTemp - current.targetTemp) +
        Math.abs(next.insideTemp - next.targetTemp)) /
      2;

    const x1 = xScale(current.time);
    const x2 = xScale(next.time, { position: "end" });
    const yInside1 = yScale(current.insideTemp);
    const yTarget1 = yScale(current.targetTemp);
    const yInside2 = yScale(next.insideTemp);
    const yTarget2 = yScale(next.targetTemp);

    if (
      [x1, x2, yInside1, yTarget1, yInside2, yTarget2].some(
        (value) => value == null || Number.isNaN(value),
      )
    ) {
      continue;
    }

    const xMid = (x1 + x2) / 2;
    const yTargetMid = (yTarget1 + yTarget2) / 2;
    const yInsideMid = (yInside1 + yInside2) / 2;
    const gradientId = `${baseId}-comfort-${index}`;

    segments.push({
      key: `${current.time}-${next.time}`,
      gradientId,
      xMid,
      yTargetMid,
      yInsideMid,
      insideColor: deltaToColor(delta),
      path: `M ${x1} ${yInside1} L ${x2} ${yInside2} L ${x2} ${yTarget2} L ${x1} ${yTarget1} Z`,
    });
  }

  if (segments.length === 0) return null;

  return (
    <g className="comfort-delta-bands">
      <defs>
        {segments.map(({ gradientId, xMid, yTargetMid, yInsideMid, insideColor }) => (
          <linearGradient
            key={gradientId}
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={xMid}
            y1={yTargetMid}
            x2={xMid}
            y2={yInsideMid}
          >
            <stop offset="0%" stopColor={COMFORT_TARGET_COLOR} />
            <stop offset="100%" stopColor={insideColor} />
          </linearGradient>
        ))}
      </defs>
      {segments.map(({ key, gradientId, path }) => (
        <path key={key} d={path} fill={`url(#${gradientId})`} stroke="none" />
      ))}
    </g>
  );
}
