"use client";

import React, { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { UploadCohortModal } from "@/components/UploadCohortModal";
import {
  ArrowLeft,
  UploadCloud,
  Download,
  Users,
  Clock,
  Phone,
  Shield,
  Search,
  RefreshCw,
  Calendar,
} from "lucide-react";
import { CampaignStatus, ContactStatus } from "@/types";

interface ContactItem {
  id: string;
  leadId?: string | null;
  phoneNumber: string;
  firstName?: string | null;
  lastName?: string | null;
  status: ContactStatus;
  retryCount: number;
  maxRetries: number;
  customVariables?: Record<string, unknown> | null;
  createdAt: string;
}

interface CampaignDetail {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  sarvamAgentId?: string | null;
  agentAppId?: string | null;
  agentVersion?: string | null;
  agentType?: string | null;
  requiredVariables: string[];
  connectionId?: string | null;
  callerPhoneNumber?: string | null;
  maxRequestsPerSecond: number;
  concurrencyLimit: number;
  maxRetries: number;
  retryIntervalMinutes: number;
  retryOnBusy: boolean;
  retryOnNoAnswer: boolean;
  retryOnShortDuration: boolean;
  shortDurationThresholdSeconds: number;
  dailyStartTime?: string | null;
  dailyEndTime?: string | null;
  timezone: string;
  allowedDays: string[];
  createdAt: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  _count: {
    contacts: number;
    callAttempts: number;
  };
}

function CampaignDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination & filter state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const queryParams = new URLSearchParams({
          page: page.toString(),
          limit: "20",
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(search ? { search } : {}),
        });

        const res = await fetch(`/api/campaigns/${id}?${queryParams.toString()}`);
        const result = await res.json();

        if (!ignore && res.ok && result.success) {
          setCampaign(result.data.campaign);
          setContacts(result.data.contacts.items);
          setTotalPages(result.data.contacts.pagination.totalPages);
          setTotalContacts(result.data.contacts.pagination.totalItems);
        } else if (!ignore && (!res.ok || !result.success)) {
          setError(result.error?.message || "Failed to load campaign");
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Error loading campaign");
      } finally {
        if (!ignore) {
          setLoading(false);
          setLoadingContacts(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [id, page, statusFilter, search, refreshTrigger]);

  const handleRefresh = () => {
    setLoadingContacts(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    handleRefresh();
  };

  const getStatusBadge = (status: CampaignStatus | ContactStatus) => {
    switch (status) {
      case "RUNNING":
      case "COMPLETED":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300";
      case "SCHEDULED":
      case "QUEUED":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300";
      case "PAUSED":
      case "IN_PROGRESS":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300";
      case "FAILED":
      case "CANCELLED":
      case "DO_NOT_CALL":
        return "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300";
      case "PENDING":
      case "DRAFT":
      default:
        return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-300";
    }
  };

  if (loading && !campaign) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-12 text-center text-sm text-zinc-500">
          Loading campaign details...
        </main>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-12 text-center">
          <p className="text-rose-600 font-semibold mb-2">Error loading campaign</p>
          <p className="text-sm text-zinc-500 mb-4">{error || "Campaign not found"}</p>
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Navigation Breadcrumb & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="space-y-1">
            <Link
              href="/"
              className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Back to Dashboard
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {campaign.name}
              </h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
                  campaign.status
                )}`}
              >
                {campaign.status}
              </span>
            </div>
            {campaign.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{campaign.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/api/campaigns/${campaign.id}/contacts/sample`}
              download
              className="inline-flex items-center px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-2xs"
            >
              <Download className="w-4 h-4 mr-1.5" />
              Download Sample CSV
            </a>
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
            >
              <UploadCloud className="w-4 h-4 mr-1.5" />
              Upload Contacts CSV
            </button>
          </div>
        </div>

        {/* Configuration Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Agent Configuration */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3 shadow-xs">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-sm">
              <Phone className="w-4 h-4 text-blue-600" />
              <span>Voice Agent Configuration</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Sarvam Agent ID:</span>
                <span className="font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.sarvamAgentId || "Default"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Agent App ID:</span>
                <span className="font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.agentAppId || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Agent Version:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.agentVersion || "v1"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block mb-1">Required Prompt Variables:</span>
                {campaign.requiredVariables.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {campaign.requiredVariables.map((v) => (
                      <span
                        key={v}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono text-2xs"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-zinc-400 italic">None specified</span>
                )}
              </div>
            </div>
          </div>

          {/* Calling Windows & Telephony */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3 shadow-xs">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-sm">
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>Calling Windows & Telephony</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Allowed Hours:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.dailyStartTime || "09:00"} – {campaign.dailyEndTime || "18:00"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Timezone:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.timezone}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Caller Phone ID:</span>
                <span className="font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.callerPhoneNumber || "Provider Default"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Rate Limit:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.maxRequestsPerSecond} req / sec
                </span>
              </div>
              <div className="flex items-center gap-1 text-2xs text-zinc-500 pt-1">
                <Calendar className="w-3 h-3" />
                <span>Days: {campaign.allowedDays.join(", ")}</span>
              </div>
            </div>
          </div>

          {/* Retry & Concurrency Controls */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3 shadow-xs">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-sm">
              <Shield className="w-4 h-4 text-purple-600" />
              <span>Retry & Concurrency Rules</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Max Attempts / Contact:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.maxRetries} attempts
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Retry Backoff Interval:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.retryIntervalMinutes} minutes
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Concurrency Limit:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {campaign.concurrencyLimit} simultaneous calls
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Retry Conditions:</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {[
                    campaign.retryOnBusy && "Busy",
                    campaign.retryOnNoAnswer && "No Answer",
                    campaign.retryOnShortDuration && "<15s",
                  ]
                    .filter(Boolean)
                    .join(", ") || "None"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Contacts Section */}
        <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs">
          <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-500" />
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Cohort Contacts ({totalContacts})
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <form onSubmit={handleSearchSubmit} className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search phone, name, lead ID..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 w-56"
                />
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" />
              </form>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="QUEUED">Queued</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="FAILED">Failed</option>
                <option value="DO_NOT_CALL">Do Not Call</option>
              </select>

              <button
                type="button"
                onClick={handleRefresh}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Refresh table"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingContacts ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Table */}
          {contacts.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                No contacts found in this cohort
              </p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Upload a CSV cohort containing customer phone numbers and prompt variables to populate this campaign.
              </p>
              <button
                type="button"
                onClick={() => setIsUploadOpen(true)}
                className="inline-flex items-center px-4 py-2 text-xs font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                Upload CSV Cohort
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3 font-medium">Lead ID</th>
                    <th className="px-5 py-3 font-medium">Phone Number</th>
                    <th className="px-5 py-3 font-medium">Customer Name</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Retries</th>
                    <th className="px-5 py-3 font-medium">Custom Prompt Variables</th>
                    <th className="px-5 py-3 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="px-5 py-3 font-mono text-zinc-600 dark:text-zinc-300">
                        {contact.leadId || "—"}
                      </td>
                      <td className="px-5 py-3 font-medium font-mono text-zinc-900 dark:text-zinc-100">
                        {contact.phoneNumber}
                      </td>
                      <td className="px-5 py-3 text-zinc-700 dark:text-zinc-300">
                        {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border ${getStatusBadge(
                            contact.status
                          )}`}
                        >
                          {contact.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-300">
                        {contact.retryCount} / {contact.maxRetries}
                      </td>
                      <td className="px-5 py-3">
                        {contact.customVariables &&
                        Object.keys(contact.customVariables).length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {Object.entries(contact.customVariables).map(([k, v]) => (
                              <span
                                key={k}
                                className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-2xs"
                              >
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-400 text-2xs">
                        {new Date(contact.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
              <span>
                Page {page} of {totalPages} ({totalContacts} contacts)
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 rounded border border-zinc-300 dark:border-zinc-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      <UploadCohortModal
        isOpen={isUploadOpen}
        campaignId={campaign.id}
        campaignName={campaign.name}
        requiredVariables={campaign.requiredVariables}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={handleRefresh}
      />
    </div>
  );
}

export default function CampaignDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
          <Navbar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-12 text-center text-sm text-zinc-500">
            Loading campaign...
          </main>
        </div>
      }
    >
      <CampaignDetailContent {...props} />
    </Suspense>
  );
}
