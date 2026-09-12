"use client";

import { useState } from "react";

export type PieChartDatum = {
  key: string;
  label: string;
  value: number;
  color: string;
};

type Props = {
  data: PieChartDatum[];
  size?: number;
  className?: string;
};

const CX = 50;
const CY = 50;
const R = 48;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;

  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describeSlice(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

export function PieChart({ data, size = 220, className = "" }: Props) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const nonZero = data.filter((d) => d.value > 0);

  const angleFor = (d: PieChartDatum) =>
    total > 0 ? (d.value / total) * 360 : 0;

  const slices = nonZero.map((d, index) => {
    const startAngle = nonZero
      .slice(0, index)
      .reduce((sum, item) => sum + angleFor(item), 0);

    return {
      ...d,
      startAngle,
      endAngle: startAngle + angleFor(d),
    };
  });

  const hovered = data.find((d) => d.key === hoveredKey) ?? null;
  const hoveredPercentage =
    hovered && total > 0 ? Math.round((hovered.value / total) * 100) : null;

  return (
    <div className={`flex flex-col items-center gap-6 sm:flex-row ${className}`}>
      <div className="flex flex-col items-center gap-3">
        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          role="img"
          aria-label="Fleet status breakdown"
        >
          {total === 0 ? (
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke="#E5E7EB"
              strokeWidth={2}
            />
          ) : slices.length === 1 ? (
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill={slices[0].color}
              stroke="#ffffff"
              strokeWidth={hoveredKey === slices[0].key ? 0 : 1}
              tabIndex={0}
              role="img"
              aria-label={`${slices[0].label}: ${slices[0].value} vehicles (100%)`}
              onMouseEnter={() => setHoveredKey(slices[0].key)}
              onMouseLeave={() => setHoveredKey(null)}
              onFocus={() => setHoveredKey(slices[0].key)}
              onBlur={() => setHoveredKey(null)}
              style={{
                cursor: "pointer",
                filter:
                  hoveredKey === slices[0].key
                    ? "brightness(1.08)"
                    : undefined,
              }}
            />
          ) : (
            slices.map((slice) => {
              const percentage =
                total > 0 ? Math.round((slice.value / total) * 100) : 0;

              return (
                <path
                  key={slice.key}
                  d={describeSlice(CX, CY, R, slice.startAngle, slice.endAngle)}
                  fill={slice.color}
                  stroke="#ffffff"
                  strokeWidth={1}
                  tabIndex={0}
                  role="img"
                  aria-label={`${slice.label}: ${slice.value} vehicles (${percentage}%)`}
                  onMouseEnter={() => setHoveredKey(slice.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onFocus={() => setHoveredKey(slice.key)}
                  onBlur={() => setHoveredKey(null)}
                  style={{
                    cursor: "pointer",
                    filter:
                      hoveredKey === slice.key ? "brightness(1.08)" : undefined,
                    transformOrigin: "50px 50px",
                    transform:
                      hoveredKey === slice.key ? "scale(1.03)" : undefined,
                    transition: "transform 0.1s ease, filter 0.1s ease",
                  }}
                />
              );
            })
          )}
        </svg>

        <p className="text-center text-sm text-gray-600">
          {hovered
            ? `${hovered.label} — ${hovered.value} vehicle${
                hovered.value === 1 ? "" : "s"
              } (${hoveredPercentage}%)`
            : `${total} vehicle${total === 1 ? "" : "s"} total`}
        </p>
      </div>

      <div className="w-full space-y-2 sm:w-auto">
        {data.map((d) => {
          const percentage = total > 0 ? Math.round((d.value / total) * 100) : 0;

          return (
            <div
              key={d.key}
              onMouseEnter={() => setHoveredKey(d.key)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition ${
                hoveredKey === d.key ? "bg-gray-50" : ""
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="min-w-[90px] flex-1 text-gray-700">
                {d.label}
              </span>
              <span className="font-medium text-gray-900">{d.value}</span>
              <span className="w-10 text-right text-xs text-gray-400">
                {percentage}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
