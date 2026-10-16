import React from "react";
import { Plus, Megaphone, LucideIcon } from "lucide-react";
import { Button } from "./ui/Button";

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onCreateCampaign?: () => void;
  action?: React.ReactNode;
}

export function EmptyState({
  title = "No campaigns found",
  description = "No voice campaigns exist yet. Create a campaign with an agent configuration, dialing schedule, and cohort to begin outreach.",
  icon: Icon = Megaphone,
  actionLabel = "Create first campaign",
  onCreateCampaign,
  action,
}: EmptyStateProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 sm:p-14 text-center shadow-xs">
      <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">{description}</p>
      {action ? (
        action
      ) : onCreateCampaign ? (
        <Button
          onClick={onCreateCampaign}
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
