import React from "react";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  icon?: LucideIcon;
  badge?: string;
  badgeVariant?: "default" | "success" | "warning" | "error" | "info";
  iconColor?: "blue" | "emerald" | "amber" | "purple" | "slate";
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  badge,
  badgeVariant = "info",
  iconColor = "blue",
}: StatCardProps) {
  const iconBgStyles = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    purple: "bg-indigo-50 text-indigo-600",
    slate: "bg-slate-100 text-slate-600",
  };

  const badgeStyles = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-slate-300 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-600">{title}</span>
        {Icon && (
          <div className={`p-2 rounded-lg ${iconBgStyles[iconColor]}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          {value}
        </span>
        {badge && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium border ${badgeStyles[badgeVariant]}`}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}
