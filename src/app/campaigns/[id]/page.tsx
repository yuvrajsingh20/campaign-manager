"use client";

import React, { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  Users,
  Clock,
  Phone,
  Shield,
  Search,
  RefreshCw,
  Play,
  Pause,
  Square,
  AlertCircle,
  List,
  Edit2,
} from "lucide-react";
import { CampaignStatus, ContactStatus } from "@/types";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { UploadCohortModal } from "@/components/UploadCohortModal";
import { EditCampaignModal } from "@/components/EditCampaignModal";
import { EmptyState } from "@/components/EmptyState";

interface CallAttemptItem {
  id: string;
  attemptNumber: number;
  status: string;
  externalCallId: string | null;
  durationSeconds: number | null;
  failureReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

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
  callAttempts?: CallAttemptItem[];
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

interface StatusCounts {
  TOTAL: number;
  PENDING: number;
  QUEUED: number;
  IN_PROGRESS: number;
  COMPLETED: number;
  FAILED: number;
  DO_NOT_CALL: number;
  RETRYING: number;
}

function CampaignDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    TOTAL: 0,
    PENDING: 0,
    QUEUED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    FAILED: 0,
    DO_NOT_CALL: 0,
    RETRYING: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination & filter state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Lifecycle action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  // Contact history modal state
  const [selectedContactHistory, setSelectedContactHistory] = useState<ContactItem | null>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [canManage, setCanManage] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.data?.user?.role === "MEMBER") {
          setCanManage(false);
        }
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

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
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const result = await res.json();

        if (!ignore && res.ok && result.success) {
          setCampaign(result.data.campaign);
          setContacts(result.data.contacts.items);
          setTotalPages(result.data.contacts.pagination.totalPages);
          setTotalContacts(result.data.contacts.pagination.totalItems);
          if (result.data.statusCounts) {
            setStatusCounts(result.data.statusCounts);
          }
          if (result.data.campaign.status === "RUNNING") {
            setAutoPoll(true);
          }
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
  }, [id, page, statusFilter, search, refreshTrigger, router]);

  // Polling effect: Polls campaign and contact stats every 3 seconds while active
  useEffect(() => {
    if (!autoPoll || campaign?.status !== "RUNNING") return;
    const interval = setInterval(() => {
      setRefreshTrigger((prev) => prev + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, [autoPoll, campaign?.status]);

  const handleRefresh = () => {
    setLoadingContacts(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleLifecycleAction = async (action: "start" | "pause" | "resume" | "stop") => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || `Failed to ${action} campaign`);
      }
      handleRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
      setShowStopConfirm(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    handleRefresh();
  };

  if (loading) {
    return (
      <DashboardLayout
        breadcrumbs={[
          { label: "Campaigns", href: "/" },
          { label: "Loading..." },
        ]}
      >
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Loading campaign details...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !campaign) {
    return (
      <DashboardLayout
        breadcrumbs={[
          { label: "Campaigns", href: "/" },
          { label: "Not found" },
        ]}
      >
        <div className="max-w-md mx-auto py-12">
          <EmptyState
            title="Campaign not found"
            description={error || "The requested campaign does not exist or has been removed."}
            icon={AlertCircle}
            action={
              <Link href="/">
                <Button variant="primary">Return to campaigns</Button>
              </Link>
            }
          />
        </div>
      </DashboardLayout>
    );
  }

  // Database-backed status counts
  const pendingFirstAttemptCount = Math.max(
    0,
    (statusCounts.PENDING || 0) + (statusCounts.QUEUED || 0) - (statusCounts.RETRYING || 0)
  );
  const retryingCount = statusCounts.RETRYING || 0;
  const inProgressCount = statusCounts.IN_PROGRESS || 0;
  const completedCount = statusCounts.COMPLETED || 0;
  const failedCount = (statusCounts.FAILED || 0) + (statusCounts.DO_NOT_CALL || 0);

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: "Campaigns", href: "/" },
        { label: campaign.name },
      ]}
      actions={
        <div className="flex items-center gap-2">
          {canManage && campaign.status === "DRAFT" && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => handleLifecycleAction("start")}
              disabled={actionLoading || campaign._count.contacts === 0}
              icon={<Play className="w-3.5 h-3.5 fill-current" />}
              title={
                campaign._count.contacts === 0
                  ? "Upload cohort before starting"
                  : "Start campaign"
              }
            >
              Start campaign
            </Button>
          )}

          {canManage && campaign.status === "RUNNING" && (
            <>
              <Button
                size="sm"
                variant="warning-outline"
                onClick={() => handleLifecycleAction("pause")}
                disabled={actionLoading}
                icon={<Pause className="w-3.5 h-3.5" />}
              >
                Pause
              </Button>
              <Button
                size="sm"
                variant="destructive-outline"
                onClick={() => setShowStopConfirm(true)}
                disabled={actionLoading}
                icon={<Square className="w-3.5 h-3.5 fill-current" />}
              >
                Stop
              </Button>
            </>
          )}

          {canManage && campaign.status === "PAUSED" && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => handleLifecycleAction("resume")}
                disabled={actionLoading}
                icon={<Play className="w-3.5 h-3.5 fill-current" />}
              >
                Resume
              </Button>
              <Button
                size="sm"
                variant="destructive-outline"
                onClick={() => setShowStopConfirm(true)}
                disabled={actionLoading}
                icon={<Square className="w-3.5 h-3.5 fill-current" />}
              >
                Stop
              </Button>
            </>
          )}

          {canManage &&
            (campaign.status === "DRAFT" ||
              campaign.status === "SCHEDULED" ||
              campaign.status === "PAUSED") && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsEditOpen(true)}
              icon={<Edit2 className="w-3.5 h-3.5" />}
            >
              Edit configuration
            </Button>
          )}

          {canManage && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsUploadOpen(true)}
              icon={<UploadCloud className="w-3.5 h-3.5" />}
            >
              Upload cohort
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {campaign.name}
              </h1>
              <Badge status={campaign.status} dot />
            </div>
            {campaign.description && (
              <p className="text-sm text-slate-500 max-w-3xl leading-relaxed">
                {campaign.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-slate-500 pt-1 flex-wrap">
              <span>
                Workspace: <strong className="text-slate-700 font-medium">{campaign.workspace.name}</strong>
              </span>
              <span>•</span>
              <span>
                Rate limit: <strong className="text-slate-700 font-medium">{campaign.maxRequestsPerSecond} req/s</strong>
              </span>
              <span>•</span>
              <span>
                ID: <code className="text-slate-600 font-mono text-[11px]">{campaign.id}</code>
              </span>
            </div>
          </div>
        </div>

        {/* Action Error Alert */}
        {actionError && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Action error:</span> {actionError}
            </div>
          </div>
        )}

        {/* Execution Metric Breakdown (6 cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-slate-500 block">Total cohort</span>
            <span className="text-xl sm:text-2xl font-semibold text-slate-900 mt-0.5 block">
              {statusCounts.TOTAL.toLocaleString()}
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-slate-500 block">Pending (1st call)</span>
            <span className="text-xl sm:text-2xl font-semibold text-slate-700 mt-0.5 block">
              {pendingFirstAttemptCount.toLocaleString()}
            </span>
          </div>

          <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-indigo-700 block">In progress</span>
            <span className="text-xl sm:text-2xl font-semibold text-indigo-900 mt-0.5 block">
              {inProgressCount.toLocaleString()}
            </span>
          </div>

          <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-amber-700 block">Retrying</span>
            <span className="text-xl sm:text-2xl font-semibold text-amber-900 mt-0.5 block">
              {retryingCount.toLocaleString()}
            </span>
          </div>

          <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-emerald-700 block">Answered</span>
            <span className="text-xl sm:text-2xl font-semibold text-emerald-900 mt-0.5 block">
              {completedCount.toLocaleString()}
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-center shadow-2xs">
            <span className="text-[11px] font-medium text-slate-600 block">Failed / DNC</span>
            <span className="text-xl sm:text-2xl font-semibold text-slate-800 mt-0.5 block">
              {failedCount.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Configuration Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
          {/* 1. Agent & Telephony Box */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Phone className="w-4 h-4" />
                </div>
                <CardTitle className="text-sm">Agent & telephony</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-slate-600">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Agent App ID:</span>
                <strong className="text-slate-900">{campaign.agentAppId || "default_app"}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Version:</span>
                <strong className="text-slate-900">{campaign.agentVersion || "1"}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Caller phone:</span>
                <span className="font-mono text-slate-800 font-medium">
                  {campaign.callerPhoneNumber || "Default"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Connection ID:</span>
                <span className="text-slate-800 font-mono text-[11px]">
                  {campaign.connectionId || "Default"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 2. Dialing Schedule Box */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Clock className="w-4 h-4" />
                </div>
                <CardTitle className="text-sm">Calling window</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-slate-600">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Timezone:</span>
                <strong className="text-slate-900">{campaign.timezone}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Daily hours:</span>
                <strong className="text-slate-900">
                  {campaign.dailyStartTime || "09:00"} – {campaign.dailyEndTime || "18:00"}
                </strong>
              </div>
              <div className="pt-1">
                <span className="text-slate-500 block mb-1.5">Permitted days:</span>
                <div className="flex flex-wrap gap-1.5">
                  {campaign.allowedDays.map((d) => (
                    <span
                      key={d}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium"
                    >
                      {d.slice(0, 3)}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Retry Rules Box */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Shield className="w-4 h-4" />
                </div>
                <CardTitle className="text-sm">Retry rules & limits</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-slate-600">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Max attempts / lead:</span>
                <strong className="text-slate-900">{campaign.maxRetries}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Retry interval:</span>
                <strong className="text-slate-900">{campaign.retryIntervalMinutes} min</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Rate limit:</span>
                <strong className="text-slate-900">{campaign.maxRequestsPerSecond} req/s</strong>
              </div>
              <div className="pt-1 flex flex-wrap gap-1">
                {campaign.retryOnBusy && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-medium border border-amber-200">
                    Retry busy
                  </span>
                )}
                {campaign.retryOnNoAnswer && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-medium border border-amber-200">
                    Retry no answer
                  </span>
                )}
                {campaign.retryOnShortDuration && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-medium border border-amber-200">
                    Short calls &lt;{campaign.shortDurationThresholdSeconds}s
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Contacts Section */}
        <section className="space-y-4">
          <Card>
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Cohort contacts
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                  {totalContacts} records
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                {/* Auto-poll toggle */}
                <label className="flex items-center gap-2 cursor-pointer px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={autoPoll}
                    onChange={(e) => setAutoPoll(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium text-slate-700">Auto-poll (3s)</span>
                </label>

                {/* Search */}
                <form onSubmit={handleSearchSubmit} className="relative w-48 sm:w-56">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search phone or name..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                </form>

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="">Status: All ({statusCounts.TOTAL})</option>
                  <option value="RETRYING">Retrying ({statusCounts.RETRYING})</option>
                  <option value="PENDING">Pending ({statusCounts.PENDING})</option>
                  <option value="QUEUED">Queued ({statusCounts.QUEUED})</option>
                  <option value="IN_PROGRESS">In progress ({statusCounts.IN_PROGRESS})</option>
                  <option value="COMPLETED">Completed ({statusCounts.COMPLETED})</option>
                  <option value="FAILED">Failed ({statusCounts.FAILED})</option>
                  <option value="DO_NOT_CALL">Do not call ({statusCounts.DO_NOT_CALL})</option>
                </select>

                <Button
                  size="xs"
                  variant="secondary"
                  onClick={handleRefresh}
                  icon={
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingContacts ? "animate-spin" : ""}`} />
                  }
                />
              </div>
            </div>

            {/* Contacts Table */}
            {contacts.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  No cohort contacts found
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Upload a customer cohort CSV containing phone numbers and agent variables to populate this campaign.
                </p>
                <div className="pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setIsUploadOpen(true)}
                    icon={<UploadCloud className="w-3.5 h-3.5" />}
                  >
                    Upload CSV cohort
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-xs font-semibold">
                    <tr>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Phone number</th>
                      <th className="px-4 py-3">Customer name</th>
                      <th className="px-4 py-3">Lead ID</th>
                      <th className="px-4 py-3">Attempts</th>
                      <th className="px-4 py-3">Custom variables</th>
                      <th className="px-4 py-3 text-right">Call history</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {contacts.map((contact) => {
                      const isRetrying =
                        contact.retryCount > 0 &&
                        (contact.status === "PENDING" || contact.status === "QUEUED");
                      return (
                        <tr key={contact.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap">
                            {isRetrying ? (
                              <Badge variant="warning" dot>
                                Retry #{contact.retryCount + 1}
                              </Badge>
                            ) : (
                              <Badge status={contact.status} dot />
                            )}
                          </td>

                          <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                            {contact.phoneNumber}
                          </td>

                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                          </td>

                          <td className="px-4 py-3 text-slate-500 font-mono text-xs whitespace-nowrap">
                            {contact.leadId || "—"}
                          </td>

                          <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">
                            {contact.retryCount} / {contact.maxRetries}
                          </td>

                          <td className="px-4 py-3">
                            {contact.customVariables &&
                            Object.keys(contact.customVariables).length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {Object.entries(contact.customVariables).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-mono"
                                  >
                                    {k}={String(v)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => setSelectedContactHistory(contact)}
                              icon={<List className="w-3.5 h-3.5" />}
                            >
                              Log ({contact.callAttempts?.length || 0})
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs bg-slate-50/60">
                <span className="text-slate-600">
                  Page <strong className="text-slate-900 font-semibold">{page}</strong> of{" "}
                  <strong className="text-slate-900 font-semibold">{totalPages}</strong> ({totalContacts} contacts)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* Stop Confirmation Dialog */}
        <Modal
          isOpen={showStopConfirm}
          onClose={() => setShowStopConfirm(false)}
          title="Confirm campaign termination"
          description="Are you sure you want to halt this campaign?"
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5 text-rose-900">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Irreversible action</span>
              </div>
              <p>
                Stopping this campaign transitions it to <code className="font-semibold font-mono">CANCELLED</code>.
                All pending or retrying contacts will be set to <code className="font-semibold font-mono">DO_NOT_CALL</code>.
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="secondary"
                onClick={() => setShowStopConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                isLoading={actionLoading}
                onClick={() => handleLifecycleAction("stop")}
              >
                Yes, stop campaign
              </Button>
            </div>
          </div>
        </Modal>

        {/* Call Attempt History Modal */}
        {selectedContactHistory && (
          <Modal
            isOpen={Boolean(selectedContactHistory)}
            onClose={() => setSelectedContactHistory(null)}
            title={`Call attempt log — ${selectedContactHistory.phoneNumber}`}
            description={`Lead ID: ${selectedContactHistory.leadId || "—"} • Retries: ${selectedContactHistory.retryCount} / ${selectedContactHistory.maxRetries}`}
            maxWidth="xl"
          >
            <div className="space-y-4">
              {!selectedContactHistory.callAttempts ||
              selectedContactHistory.callAttempts.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No outbound call attempts have been initiated yet for this contact.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs overflow-hidden">
                  {selectedContactHistory.callAttempts.map((attempt) => (
                    <div key={attempt.id} className="p-3.5 space-y-1.5 hover:bg-slate-50/50">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          Attempt #{attempt.attemptNumber}
                        </span>
                        <Badge status={attempt.status} dot />
                      </div>
                      <div className="grid grid-cols-2 gap-y-1 text-slate-600 text-[11px]">
                        <div>
                          Provider Call ID:{" "}
                          <code className="text-slate-800 font-mono">
                            {attempt.externalCallId || "Pending"}
                          </code>
                        </div>
                        <div>
                          Duration:{" "}
                          <strong className="text-slate-900">
                            {attempt.durationSeconds ?? 0}s
                          </strong>
                        </div>
                        {attempt.failureReason && (
                          <div className="col-span-2 text-rose-700 font-medium">
                            Failure reason: {attempt.failureReason}
                          </div>
                        )}
                        {attempt.startedAt && (
                          <div className="col-span-2 text-slate-400">
                            Started: {new Date(attempt.startedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  variant="primary"
                  onClick={() => setSelectedContactHistory(null)}
                >
                  Done
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* Cohort Upload Modal */}
        <UploadCohortModal
          isOpen={isUploadOpen}
          campaignId={campaign.id}
          campaignName={campaign.name}
          requiredVariables={campaign.requiredVariables}
          onClose={() => setIsUploadOpen(false)}
          onSuccess={handleRefresh}
        />

        {/* Edit Campaign Configuration Modal */}
        <EditCampaignModal
          isOpen={isEditOpen}
          campaign={campaign}
          onClose={() => setIsEditOpen(false)}
          onUpdated={handleRefresh}
        />
      </div>
    </DashboardLayout>
  );
}

export default function CampaignDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CampaignDetailContent {...props} />
    </Suspense>
  );
}
