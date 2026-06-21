import { useCallback, useEffect, useRef, useState } from "react";
import { ReferenceArea, usePlotArea, useXAxisInverseScale } from "recharts";
import { MIN_ZOOM_SPAN_MS } from "../utils/chartUtils";

function clientXToTime(clientX, plotArea, inverseX, svgRoot) {
  if (!plotArea || !inverseX || !svgRoot) return null;

  const point = svgRoot.createSVGPoint();
  point.x = clientX;
  point.y = plotArea.y + plotArea.height / 2;
  const matrix = svgRoot.getScreenCTM();
  if (!matrix) return null;

  const local = point.matrixTransform(matrix.inverse());
  const value = inverseX(local.x);
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

export default function ChartZoomBrush({ active, yAxisId = "temp", onZoomSelect }) {
  const plotArea = usePlotArea();
  const inverseX = useXAxisInverseScale(0);
  const overlayRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const finishDrag = useCallback(
    (endTime) => {
      if (!drag || endTime == null) {
        setDrag(null);
        return;
      }

      const startTime = drag.startTime;
      if (Math.abs(endTime - startTime) >= MIN_ZOOM_SPAN_MS) {
        onZoomSelect?.(startTime, endTime);
      }
      setDrag(null);
    },
    [drag, onZoomSelect],
  );

  useEffect(() => {
    if (!drag) return undefined;

    function handleMouseMove(event) {
      const svgRoot = overlayRef.current?.ownerSVGElement;
      const time = clientXToTime(event.clientX, plotArea, inverseX, svgRoot);
      if (time == null) return;
      setDrag((current) =>
        current ? { ...current, endTime: time } : current,
      );
    }

    function handleMouseUp(event) {
      const svgRoot = overlayRef.current?.ownerSVGElement;
      const time = clientXToTime(event.clientX, plotArea, inverseX, svgRoot);
      finishDrag(time ?? drag.endTime);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drag, finishDrag, inverseX, plotArea]);

  if (!active || !plotArea) return null;

  function handleMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const svgRoot = overlayRef.current?.ownerSVGElement;
    const time = clientXToTime(event.clientX, plotArea, inverseX, svgRoot);
    if (time == null) return;
    setDrag({ startTime: time, endTime: time });
  }

  const preview =
    drag?.startTime != null && drag?.endTime != null
      ? {
          x1: Math.min(drag.startTime, drag.endTime),
          x2: Math.max(drag.startTime, drag.endTime),
        }
      : null;

  return (
    <>
      {preview && (
        <ReferenceArea
          yAxisId={yAxisId}
          x1={preview.x1}
          x2={preview.x2}
          fill="#0b75b7"
          fillOpacity={0.22}
          stroke="#38bdf8"
          strokeOpacity={0.85}
          strokeWidth={1.5}
        />
      )}
      <rect
        ref={overlayRef}
        x={plotArea.x}
        y={plotArea.y}
        width={plotArea.width}
        height={plotArea.height}
        fill="transparent"
        style={{ cursor: "crosshair", pointerEvents: "all" }}
        onMouseDown={handleMouseDown}
      />
    </>
  );
}
