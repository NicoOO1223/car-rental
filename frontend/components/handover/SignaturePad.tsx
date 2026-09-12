"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type SignaturePadHandle = {
  toDataURL: () => string;
  clear: () => void;
  isEmpty: () => boolean;
};

type Props = {
  width?: number;
  height?: number;
};

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
  function SignaturePad({ width = 500, height = 200 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const [hasDrawn, setHasDrawn] = useState(false);

    useImperativeHandle(ref, () => ({
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
      clear: () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");

        if (canvas && ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        setHasDrawn(false);
      },
      isEmpty: () => !hasDrawn,
    }));

    function getPos(event: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();

      return {
        x: (event.clientX - rect.left) * (width / rect.width),
        y: (event.clientY - rect.top) * (height / rect.height),
      };
    }

    function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
      drawingRef.current = true;

      const ctx = canvasRef.current!.getContext("2d")!;
      const { x, y } = getPos(event);

      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(x, y);
    }

    function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) {
        return;
      }

      const ctx = canvasRef.current!.getContext("2d")!;
      const { x, y } = getPos(event);

      ctx.lineTo(x, y);
      ctx.stroke();

      setHasDrawn(true);
    }

    function handlePointerUp() {
      drawingRef.current = false;
    }

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="touch-none rounded-lg border border-gray-300 bg-white"
        style={{ width: "100%", maxWidth: width, height }}
      />
    );
  },
);
