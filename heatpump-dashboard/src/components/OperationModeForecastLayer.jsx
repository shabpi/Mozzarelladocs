import { usePlotArea, useXAxisScale } from "recharts";
import { getOperationModeStyle } from "../utils/operationModeUtils";

const LANE_HEIGHT = 16;

export default function OperationModeForecastLayer({ segments = [] }) {
  const plotArea = usePlotArea();
  const xScale = useXAxisScale(0);

  if (!plotArea || !xScale || segments.length === 0) {
    return null;
  }

  const laneY = plotArea.y + plotArea.height - LANE_HEIGHT + 2;

  return (
    <g className="operation-mode-lane" aria-hidden>
      <text
        x={plotArea.x + 4}
        y={laneY - 4}
        fill="rgba(255,255,255,0.45)"
        fontSize={9}
        fontWeight={500}
      >
        Heat pump
      </text>
      {segments.map((segment) => {
        const start = xScale(segment.x1);
        const end = xScale(segment.x2);
        if ([start, end].some((value) => value == null || Number.isNaN(value))) {
          return null;
        }

        const x = Math.min(start, end);
        const width = Math.max(Math.abs(end - start), 2);
        const style = getOperationModeStyle(segment.mode);

        return (
          <g key={segment.key}>
            <rect
              x={x}
              y={laneY}
              width={width}
              height={LANE_HEIGHT}
              fill={style.fill}
              fillOpacity={style.fillOpacity}
              stroke={style.stroke}
              strokeOpacity={0.7}
              strokeWidth={0.5}
              rx={2}
            />
            {width >= 36 && (
              <text
                x={x + width / 2}
                y={laneY + LANE_HEIGHT / 2 + 3}
                textAnchor="middle"
                fill="rgba(255,255,255,0.85)"
                fontSize={8}
                fontWeight={600}
              >
                {style.shortLabel}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
