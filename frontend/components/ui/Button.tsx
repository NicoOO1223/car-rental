import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-black text-white hover:bg-gray-800",
  secondary:
    "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  // Destructive actions stay monochrome too — weight (a bold border,
  // filling solid on hover) carries the "serious" cue instead of a hue.
  danger:
    "border-2 border-gray-900 bg-white text-gray-900 hover:bg-gray-900 hover:text-white",
  ghost: "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
};

export function Button({
  variant = "primary",
  fullWidth = false,
  className = "",
  disabled,
  ...props
}: Props) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANT_CLASSES[variant]
      } ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}
