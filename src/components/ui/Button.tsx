import React from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "destructive"
  | "destructive-outline"
  | "warning-outline"
  | "ghost";

export type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  isLoading = false,
  disabled,
  icon,
  className = "",
  ...props
}: ButtonProps) {
  const sizeStyles: Record<ButtonSize, string> = {
    xs: "px-2.5 py-1 text-xs gap-1 rounded-md",
    sm: "px-3 py-1.5 text-xs gap-1.5 rounded-lg",
    md: "px-4 py-2 text-sm gap-2 rounded-lg",
    lg: "px-5 py-2.5 text-base gap-2 rounded-lg",
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs focus-visible:ring-2 focus-visible:ring-blue-500/40 border border-transparent",
    secondary:
      "bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-300 shadow-xs focus-visible:ring-2 focus-visible:ring-slate-400/40",
    outline:
      "bg-transparent hover:bg-slate-100 active:bg-slate-200 text-slate-700 border border-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400/40",
    destructive:
      "bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs focus-visible:ring-2 focus-visible:ring-rose-500/40 border border-transparent",
    "destructive-outline":
      "bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200 focus-visible:ring-2 focus-visible:ring-rose-500/40",
    "warning-outline":
      "bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-800 border border-amber-200 focus-visible:ring-2 focus-visible:ring-amber-500/40",
    ghost:
      "bg-transparent hover:bg-slate-100 active:bg-slate-200 text-slate-600 focus-visible:ring-2 focus-visible:ring-slate-400/40",
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children}
    </button>
  );
}
