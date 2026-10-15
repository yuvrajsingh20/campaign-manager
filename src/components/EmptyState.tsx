import React from "react";
import { Megaphone, Plus } from "lucide-react";

interface EmptyStateProps {
  onCreateCampaign?: () => void;
}

export function EmptyState({ onCreateCampaign }: EmptyStateProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 p-12 text-center">
      <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 mx-auto flex items-center justify-center">
        <Megaphone className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        No campaigns created yet
      </h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
        Create your first outbound AI voice campaign to configure agent prompts, upload contact cohorts, and schedule calls.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={onCreateCampaign}
          className="inline-flex items-center px-4 py-2 border border-transparent shadow-xs text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Campaign
        </button>
      </div>
    </div>
  );
}

