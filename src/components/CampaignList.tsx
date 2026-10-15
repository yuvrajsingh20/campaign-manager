"use client";

import React from "react";
import Link from "next/link";
import { Users, Clock, ArrowRight, UploadCloud, ShieldAlert, Phone } from "lucide-react";
import { CampaignStatus } from "@/types";

export interface CampaignListItem {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  dailyStartTime?: string | null;
  dailyEndTime?: string | null;
  timezone: string;
  maxRetries: number;
  concurrencyLimit: number;
  callerPhoneNumber?: string | null;
  requiredVariables: string[];
  createdAt: string;
  workspace?: {
    name: string;
  };
  _count: {
    contacts: number;
  };
}

interface CampaignListProps {
  campaigns: CampaignListItem[];
  onUploadCohort: (campaign: CampaignListItem) => void;
}

export function CampaignList({ campaigns, onUploadCohort }: CampaignListProps) {
  const getStatusBadge = (status: CampaignStatus) => {
    switch (status) {
      case "RUNNING":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300";
      case "SCHEDULED":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300";
      case "PAUSED":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300";
      case "COMPLETED":
        return "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300";
      case "CANCELLED":
        return "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300";
      case "DRAFT":
      default:
        return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-300";
    }
  };

  return (
    <div className="space-y-3">
      {campaigns.map((campaign) => (
        <div
          key={campaign.id}
          className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all shadow-xs"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
                    campaign.status
                  )}`}
                >
                  {campaign.status}
                </span>
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className="text-base font-semibold text-zinc-900 dark:text-zinc-50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {campaign.name}
                </Link>
              </div>

              {campaign.description && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
                  {campaign.description}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUploadCohort(campaign)}
                className="inline-flex items-center px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                Upload Cohort
              </button>

              <Link
                href={`/campaigns/${campaign.id}`}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                View Campaign
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Link>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-zinc-400" />
              <span>
                <strong className="text-zinc-700 dark:text-zinc-200">
                  {campaign._count.contacts}
                </strong>{" "}
                contacts
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>
                {campaign.dailyStartTime || "09:00"} – {campaign.dailyEndTime || "18:00"}{" "}
                ({campaign.timezone})
              </span>
            </div>

            {campaign.callerPhoneNumber && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-zinc-400" />
                <span>Caller: {campaign.callerPhoneNumber}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-zinc-400" />
              <span>Retries: max {campaign.maxRetries}</span>
            </div>

            <div className="ml-auto text-zinc-400 text-2xs">
              Created {new Date(campaign.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

