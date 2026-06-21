import { usePlotArea, useYAxisScale } from "recharts";
import { CO2_QUALITY_ZONES } from "../utils/co2Utils";

export default function Co2QualityZonesLayer({ showCo2QualityZones }) {
  const plotArea = usePlotArea();
  const yScale = useYAxisScale("co2");

  if (!showCo2QualityZones || !plotArea || !yScale) {
    return null;
  }

  const xStart = plotArea.x;
  const xEnd = plotArea.x + plotArea.width;

  return (
    <g className="co2-quality-zones" aria-hidden>
      {CO2_QUALITY_ZONES.map((zone) => {
        const yTop = yScale(zone.max);
        const yBottom = yScale(zone.min);
        if (
          [yTop, yBottom].some((value) => value == null || Number.isNaN(value))
        ) {
          return null;
        }

        const height = Math.abs(yBottom - yTop);
        const y = Math.min(yTop, yBottom);

        return (
          <g key={zone.label}>
            <rect
              x={xStart}
              y={y}
              width={Math.abs(xEnd - xStart)}
              height={height}
              fill={zone.color}
              stroke="none"
            />
            <text
              x={xEnd - 6}
              y={y + 12}
              textAnchor="end"
              fill="rgba(255,255,255,0.45)"
              fontSize={10}
              fontWeight={500}
            >
              {zone.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
