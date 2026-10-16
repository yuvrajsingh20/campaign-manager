import React from "react";

export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "purple";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  status?: string;
  dot?: boolean;
  children?: React.ReactNode;
}

export function Badge({
  variant,
  status,
  dot,
  children,
  className = "",
  ...props
}: BadgeProps) {
  // Determine variant from status string if status is provided
  let computedVariant: BadgeVariant = variant || "default";

  if (status) {
    const s = status.toUpperCase();
    if (["RUNNING", "ACTIVE", "COMPLETED", "ANSWERED"].includes(s)) {
      computedVariant = "success";
    } else if (["PAUSED", "RETRYING", "WARNING"].includes(s)) {
      computedVariant = "warning";
    } else if (["FAILED", "CANCELLED", "INACTIVE", "ERROR"].includes(s)) {
      computedVariant = "error";
    } else if (["SCHEDULED", "INFO"].includes(s)) {
      computedVariant = "info";
    } else if (["IN_PROGRESS", "BUSY"].includes(s)) {
      computedVariant = "purple";
    } else if (["DRAFT", "PENDING", "QUEUED", "DO_NOT_CALL"].includes(s)) {
      computedVariant = "neutral";
    }
  }

  const variantStyles: Record<BadgeVariant, { bg: string; text: string; border: string; dot: string }> = {
    default: {
      bg: "bg-slate-100",
      text: "text-slate-700",
      border: "border-slate-200",
      dot: "bg-slate-500",
    },
    neutral: {
      bg: "bg-slate-100",
      text: "text-slate-600",
      border: "border-slate-200",
      dot: "bg-slate-400",
    },
    success: {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      border: "border-emerald-200",
      dot: "bg-emerald-500",
    },
    warning: {
      bg: "bg-amber-50",
      text: "text-amber-700",
      border: "border-amber-200",
      dot: "bg-amber-500",
    },
    error: {
      bg: "bg-rose-50",
      text: "text-rose-700",
      border: "border-rose-200",
      dot: "bg-rose-500",
    },
    info: {
      bg: "bg-blue-50",
      text: "text-blue-700",
      border: "border-blue-200",
      dot: "bg-blue-500",
    },
    purple: {
      bg: "bg-indigo-50",
      text: "text-indigo-700",
      border: "border-indigo-200",
      dot: "bg-indigo-500",
    },
  };

  const style = variantStyles[computedVariant];

  // Format label text to sentence/title case if raw status was passed as children or status
  const displayContent = children ?? (status ? formatStatusText(status) : null);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${style.bg} ${style.text} ${style.border} ${className}`}
      {...props}
    >
      {(dot || computedVariant === "purple") && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot} ${
            computedVariant === "purple" ? "animate-pulse" : ""
          }`}
        />
      )}
      {displayContent}
    </span>
  );
}

function formatStatusText(str: string): string {
  // Convert RUNNING -> Running, IN_PROGRESS -> In progress, etc.
  return str
    .split("_")
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.toLowerCase()
    )
    .join(" ");
}
