"use client";

import { useRef, useState } from "react";
import { formatCalendarDate } from "@/lib/format";
import { t } from "@/lib/i18n";

export type LineChartPoint = {
  date: string;
  value: number;
};

type Props = {
  data: LineChartPoint[];
  formatValue?: (value: number) => string;
  className?: string;
};

// A single series needs no legend — the card title already names it.
// This app is deliberately monochrome, so the line/area use near-black
// ink rather than an accent hue.
const LINE_COLOR = "#111827";

const WIDTH = 680;
// ~40% of the chart's original height (220) — the horizontal scale is
// set purely by width (viewBox height doesn't affect it, since the SVG
// has no fixed height of its own), so shrinking this alone shortens the
// rendered chart without shrinking text/strokes.
const HEIGHT = 88;
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 28;

const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const BASELINE_Y = PADDING_TOP + PLOT_HEIGHT;

function formatShortDate(dateStr: string) {
  // Chart points are calendar days ("2040-06-15"), never shifted by a zone.
  return formatCalendarDate(dateStr, { day: "numeric", month: "short" });
}

export function LineChart({ data, formatValue, className = "" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const format = formatValue ?? ((value: number) => value.toFixed(2));

  const maxValue = Math.max(1, ...data.map((d) => d.value));

  const xFor = (index: number) => {
    if (data.length <= 1) {
      return PADDING_LEFT + PLOT_WIDTH / 2;
    }

    return PADDING_LEFT + (index / (data.length - 1)) * PLOT_WIDTH;
  };

  const yFor = (value: number) =>
    PADDING_TOP + (1 - value / maxValue) * PLOT_HEIGHT;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(d.value)}`)
    .join(" ");

  const areaPath =
    data.length > 0
      ? `M ${xFor(0)} ${BASELINE_Y} ` +
        data.map((d, i) => `L ${xFor(i)} ${yFor(d.value)}`).join(" ") +
        ` L ${xFor(data.length - 1)} ${BASELINE_Y} Z`
      : "";

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (data.length === 0 || !svgRef.current) {
      return;
    }

    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const xInViewBox = (event.clientX - rect.left) * scaleX;

    let nearest = 0;
    let nearestDistance = Infinity;

    data.forEach((_, i) => {
      const distance = Math.abs(xFor(i) - xInViewBox);

      if (distance < nearestDistance) {
        nearest = i;
        nearestDistance = distance;
      }
    });

    setHoverIndex(nearest);
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const lastPoint = data[data.length - 1];

  // Sparse date labels: first, middle, last — never one per day.
  const labelIndices = new Set(
    [0, Math.floor((data.length - 1) / 2), data.length - 1].filter(
      (i) => i >= 0,
    ),
  );

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={t("c.charts.LineChart.revenueOverTime")}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* Baseline */}
        <line
          x1={PADDING_LEFT}
          y1={BASELINE_Y}
          x2={WIDTH - PADDING_RIGHT}
          y2={BASELINE_Y}
          stroke="#e1e0d9"
          strokeWidth={1}
        />

        {/* Area wash */}
        {areaPath && (
          <path d={areaPath} fill={LINE_COLOR} fillOpacity={0.1} stroke="none" />
        )}

        {/* Line */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={LINE_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* End value + dot */}
        {lastPoint && (
          <>
            <circle
              cx={xFor(data.length - 1)}
              cy={yFor(lastPoint.value)}
              r={3}
              fill={LINE_COLOR}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            <text
              x={xFor(data.length - 1)}
              y={yFor(lastPoint.value) - 10}
              textAnchor="end"
              fontSize={11}
              fill="#374151"
            >
              {format(lastPoint.value)}
            </text>
          </>
        )}

        {/* Hover crosshair */}
        {hovered && (
          <>
            <line
              x1={xFor(hoverIndex!)}
              y1={PADDING_TOP}
              x2={xFor(hoverIndex!)}
              y2={BASELINE_Y}
              stroke="#c3c2b7"
              strokeWidth={1}
            />
            <circle
              cx={xFor(hoverIndex!)}
              cy={yFor(hovered.value)}
              r={4}
              fill={LINE_COLOR}
              stroke="#ffffff"
              strokeWidth={2}
            />
          </>
        )}

        {/* Date labels */}
        {data.map((d, i) =>
          labelIndices.has(i) ? (
            <text
              key={d.date}
              x={xFor(i)}
              y={HEIGHT - 8}
              textAnchor={
                i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"
              }
              fontSize={11}
              fill="#898781"
            >
              {formatShortDate(d.date)}
            </text>
          ) : null,
        )}
      </svg>

      {hovered && hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: `${(xFor(hoverIndex) / WIDTH) * 100}%`,
          }}
        >
          <div className="font-medium">{formatShortDate(hovered.date)}</div>
          <div>{format(hovered.value)}</div>
        </div>
      )}
    </div>
  );
}
