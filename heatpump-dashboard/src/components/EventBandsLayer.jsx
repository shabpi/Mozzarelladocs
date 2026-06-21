import { usePlotArea, useXAxisScale } from "recharts";

export default function EventBandsLayer({
  bands = [],
  clickable = false,
  onEventClick,
  onEventHover,
  onEventHoverEnd,
}) {
  const plotArea = usePlotArea();
  const xScale = useXAxisScale(0);

  if (!plotArea || !xScale || bands.length === 0) {
    return null;
  }

  const { y, height } = plotArea;

  return (
    <g className="event-bands">
      {bands.map((band) => {
        const start = xScale(band.x1);
        const end = xScale(band.x2);
        if ([start, end].some((value) => value == null || Number.isNaN(value))) {
          return null;
        }

        const x = Math.min(start, end);
        const width = Math.max(Math.abs(end - start), 1);

        return (
          <g key={band.key}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={band.fill}
              fillOpacity={band.fillOpacity}
              stroke={band.stroke}
              strokeOpacity={band.strokeOpacity}
              strokeWidth={band.strokeWidth}
              strokeDasharray={band.strokeDasharray}
              style={{ pointerEvents: band.pointerEvents }}
            />
            {band.label && (
              <text
                x={x + 6}
                y={y + 14}
                fill="#ffffff"
                fontSize={11}
                fontWeight={600}
                pointerEvents="none"
              >
                {band.label}
              </text>
            )}
            {clickable && (
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill="#ffffff"
                fillOpacity={0.001}
                stroke="transparent"
                style={{ cursor: "pointer", pointerEvents: band.pointerEvents ?? "all" }}
                onClick={(event) => {
                  event?.stopPropagation?.();
                  onEventClick?.(band.event);
                }}
                onMouseEnter={() => onEventHover?.(band.key)}
                onMouseLeave={() => onEventHoverEnd?.(band.key)}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
