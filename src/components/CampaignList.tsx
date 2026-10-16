"use client";

import Link from "next/link";
import { ArrowRight, UploadCloud } from "lucide-react";
import { CampaignStatus } from "@/types";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

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
    callAttempts?: number;
  };
}

interface CampaignListProps {
  campaigns: CampaignListItem[];
  onUploadCohort: (campaign: CampaignListItem) => void;
}

export function CampaignList({ campaigns, onUploadCohort }: CampaignListProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-xs font-semibold">
            <tr>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Campaign</th>
              <th className="py-3 px-4">Workspace</th>
              <th className="py-3 px-4">Calling window</th>
              <th className="py-3 px-4">Contacts</th>
              <th className="py-3 px-4">Caller ID</th>
              <th className="py-3 px-4">Created</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {campaigns.map((campaign) => (
              <tr
                key={campaign.id}
                className="hover:bg-slate-50/60 transition-colors"
              >
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <Badge status={campaign.status} dot />
                </td>

                <td className="py-3.5 px-4">
                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="font-medium text-slate-900 hover:text-blue-600 transition-colors"
                  >
                    {campaign.name}
                  </Link>
                  {campaign.description && (
                    <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                      {campaign.description}
                    </p>
                  )}
                </td>

                <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                  {campaign.workspace?.name || "Default"}
                </td>

                <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap text-xs">
                  <span>
                    {campaign.dailyStartTime || "09:00"} – {campaign.dailyEndTime || "18:00"}
                  </span>
                  <span className="text-slate-400 ml-1.5 font-normal">
                    ({campaign.timezone})
                  </span>
                </td>

                <td className="py-3.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                  {campaign._count.contacts.toLocaleString()}
                </td>

                <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap text-xs">
                  {campaign.callerPhoneNumber ? (
                    <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono text-xs">
                      {campaign.callerPhoneNumber}
                    </code>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>

                <td className="py-3.5 px-4 text-slate-500 text-xs whitespace-nowrap">
                  {new Date(campaign.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>

                <td className="py-3.5 px-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-2">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => onUploadCohort(campaign)}
                      icon={<UploadCloud className="w-3.5 h-3.5" />}
                    >
                      Cohort
                    </Button>
                    <Link href={`/campaigns/${campaign.id}`}>
                      <Button
                        size="xs"
                        variant="primary"
                        icon={<ArrowRight className="w-3.5 h-3.5" />}
                      >
                        View
                      </Button>
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
