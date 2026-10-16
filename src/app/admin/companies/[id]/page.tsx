"use client";

import React, { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderTree,
  Users,
  Megaphone,
  Zap,
  Plus,
  Edit2,
  AlertCircle,
  Building2,
  ArrowRight,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { CreateCampaignModal } from "@/components/CreateCampaignModal";
import { EmptyState } from "@/components/EmptyState";

interface CompanyDetail {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  maxRequestsPerSecond: number;
  rateLimitPerMinute: number;
  createdAt: string;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    _count: { campaigns: number };
  }>;
  users: Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: string;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    callerPhoneNumber: string | null;
    maxRequestsPerSecond: number;
    createdAt: string;
    workspace: { id: string; name: string };
    _count: { contacts: number; callAttempts: number };
  }>;
  _count: {
    workspaces: number;
    users: number;
    campaigns: number;
  };
}

function CompanyDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Editable RPS setting
  const [rpsInput, setRpsInput] = useState<number>(5.0);
  const [isEditingRps, setIsEditingRps] = useState(false);
  const [savingRps, setSavingRps] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Workspace creation
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Campaign creation modal
  const [isCreateCampaignOpen, setIsCreateCampaignOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function fetchData() {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          router.push("/login");
          return;
        }
        const meData = await meRes.json();
        if (meData?.data?.user?.role !== "SUPERADMIN") {
          router.push("/");
          return;
        }

        const compRes = await fetch(`/api/admin/companies/${id}`);
        const compData = await compRes.json();

        if (!ignore && compData?.success && compData.data) {
          setCompany(compData.data);
          setRpsInput(compData.data.maxRequestsPerSecond);
        }
      } catch (err) {
        console.error("Failed to load company detail:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchData();
    return () => {
      ignore = true;
    };
  }, [id, refreshTrigger, router]);

  const handleUpdateRps = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRps(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxRequestsPerSecond: Number(rpsInput) }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCompany((prev) =>
          prev
            ? {
                ...prev,
                maxRequestsPerSecond: data.data.maxRequestsPerSecond,
                rateLimitPerMinute: data.data.rateLimitPerMinute,
              }
            : prev
        );
        setMessage({ text: "Organisation rate limit updated successfully.", type: "success" });
        setIsEditingRps(false);
      } else {
        setMessage({ text: data?.error?.message || "Failed to update rate limit", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error occurred", type: "error" });
    } finally {
      setSavingRps(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!company) return;
    const nextStatus = company.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setTogglingStatus(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCompany((prev) => (prev ? { ...prev, status: nextStatus } : prev));
        setMessage({
          text: `Organisation status changed to ${nextStatus}.`,
          type: "success",
        });
      } else {
        setMessage({ text: data?.error?.message || "Failed to toggle status", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error occurred", type: "error" });
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    setCreatingWorkspace(true);
    setMessage(null);

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newWorkspaceName.trim(),
          organizationId: id,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setNewWorkspaceName("");
        setShowNewWorkspace(false);
        setMessage({ text: "Workspace created successfully.", type: "success" });
        setRefreshTrigger((p) => p + 1);
      } else {
        setMessage({ text: data?.error?.message || "Failed to create workspace", type: "error" });
      }
    } catch {
      setMessage({ text: "Failed to create workspace", type: "error" });
    } finally {
      setCreatingWorkspace(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout
        breadcrumbs={[
          { label: "Organisations", href: "/admin" },
          { label: "Loading..." },
        ]}
      >
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Loading organisation records...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!company) {
    return (
      <DashboardLayout
        breadcrumbs={[
          { label: "Organisations", href: "/admin" },
          { label: "Not found" },
        ]}
      >
        <div className="max-w-md mx-auto py-12">
          <EmptyState
            title="Organisation not found"
            description="The requested organisation does not exist or has been removed."
            icon={Building2}
            action={
              <Link href="/admin">
                <Button variant="primary">Return to organisations</Button>
              </Link>
            }
          />
        </div>
      </DashboardLayout>
    );
  }

  const isActive = company.status === "ACTIVE";

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: "Organisations", href: "/admin" },
        { label: company.name },
      ]}
      actions={
        <Button
          variant={isActive ? "destructive-outline" : "primary"}
          size="sm"
          onClick={handleToggleStatus}
          isLoading={togglingStatus}
        >
          {isActive ? "Deactivate organisation" : "Activate organisation"}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {company.name}
              </h1>
              <Badge status={company.status} dot />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1.5 flex-wrap">
              <span>
                Slug: <code className="text-slate-700 font-mono">/{company.slug}</code>
              </span>
              <span>•</span>
              <span>
                ID: <code className="text-slate-600 font-mono">{company.id}</code>
              </span>
              <span>•</span>
              <span>
                Onboarded:{" "}
                <strong className="text-slate-700 font-medium">
                  {new Date(company.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Feedback Message Alert */}
        {message && (
          <div
            className={`p-4 rounded-xl text-xs flex items-center gap-2.5 border ${
              message.type === "success"
                ? "bg-emerald-50/60 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{message.text}</span>
          </div>
        )}

        {/* Organisation Overview: Balanced Grid of Three Clean Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Card 1 — Rate limit */}
          <Card className="flex flex-col justify-between">
            <div>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Zap className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-sm">Organisation rate limit</CardTitle>
                </div>
                {!isEditingRps && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setIsEditingRps(true)}
                    icon={<Edit2 className="w-3.5 h-3.5" />}
                  >
                    Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                    {company.maxRequestsPerSecond}{" "}
                    <span className="text-sm font-normal text-slate-500">requests/sec</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    Ceiling limit enforced atomically across all campaigns, background worker nodes, and telephony requests.
                  </p>
                </div>

                {isEditingRps ? (
                  <form onSubmit={handleUpdateRps} className="space-y-3 pt-2 border-t border-slate-100">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Permitted limit (requests/sec)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="100"
                        required
                        value={rpsInput}
                        onChange={(e) => setRpsInput(parseFloat(e.target.value))}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="xs"
                        variant="secondary"
                        type="button"
                        onClick={() => {
                          setRpsInput(company.maxRequestsPerSecond);
                          setIsEditingRps(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        type="submit"
                        isLoading={savingRps}
                      >
                        Save limit
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg text-xs space-y-1 text-slate-600">
                    <div className="flex justify-between">
                      <span>Enforcement window:</span>
                      <strong className="text-slate-800">1,000ms sliding window</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Per-minute equivalent:</span>
                      <strong className="text-slate-800">
                        ~{Math.round(company.maxRequestsPerSecond * 60)} req/min
                      </strong>
                    </div>
                  </div>
                )}
              </CardContent>
            </div>
          </Card>

          {/* Card 2 — Workspaces */}
          <Card className="flex flex-col justify-between">
            <div>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <FolderTree className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Workspaces</CardTitle>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                    {company.workspaces.length}
                  </span>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setShowNewWorkspace((prev) => !prev)}
                    icon={<Plus className="w-3.5 h-3.5" />}
                  >
                    {showNewWorkspace ? "Cancel" : "Create"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {showNewWorkspace && (
                  <form onSubmit={handleCreateWorkspace} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                    <label className="block font-medium text-slate-700">
                      Workspace name
                    </label>
                    <input
                      type="text"
                      required
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="e.g. Inbound Support"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="xs"
                        variant="secondary"
                        type="button"
                        onClick={() => setShowNewWorkspace(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        type="submit"
                        isLoading={creatingWorkspace}
                      >
                        Save
                      </Button>
                    </div>
                  </form>
                )}

                {company.workspaces.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No workspaces configured yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {company.workspaces.map((ws) => (
                      <div
                        key={ws.id}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="truncate">
                          <span className="font-medium text-slate-900 text-xs truncate block">
                            {ws.name}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            /{ws.slug}
                          </span>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium shrink-0">
                          {ws._count.campaigns} campaigns
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </div>
          </Card>

          {/* Card 3 — Organisation users */}
          <Card className="flex flex-col justify-between">
            <div>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Users className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-sm">Organisation users</CardTitle>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                  {company.users.length}
                </span>
              </CardHeader>
              <CardContent>
                {company.users.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No users found for this organisation.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {company.users.map((u) => (
                      <div
                        key={u.id}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="truncate">
                          <div className="font-medium text-slate-900 text-xs truncate">
                            {u.name || "User"}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {u.email}
                          </div>
                        </div>
                        <Badge
                          variant={u.role === "SUPERADMIN" ? "purple" : "info"}
                          className="text-[10px] py-0 px-2 shrink-0"
                        >
                          {u.role}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </div>
          </Card>
        </div>

        {/* Dedicated Campaigns Section */}
        <section className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold text-slate-900">Campaigns</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                  {company.campaigns.length} total
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Outbound voice campaigns configured across this organisation&apos;s workspaces.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateCampaignOpen(true)}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Create campaign
            </Button>
          </div>

          {company.campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              description="This organisation does not have any active or draft outbound voice campaigns."
              icon={Megaphone}
              actionLabel="Create campaign"
              onCreateCampaign={() => setIsCreateCampaignOpen(true)}
            />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-xs font-semibold">
                    <tr>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Campaign</th>
                      <th className="py-3 px-4">Workspace</th>
                      <th className="py-3 px-4">Contacts</th>
                      <th className="py-3 px-4">Calls made</th>
                      <th className="py-3 px-4">Caller ID</th>
                      <th className="py-3 px-4">Created</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {company.campaigns.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-50/60 transition-colors"
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <Badge status={c.status} dot />
                        </td>

                        <td className="py-3.5 px-4 font-medium text-slate-900">
                          <Link
                            href={`/campaigns/${c.id}`}
                            className="hover:text-blue-600 transition-colors"
                          >
                            {c.name}
                          </Link>
                        </td>

                        <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                          {c.workspace.name}
                        </td>

                        <td className="py-3.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                          {c._count.contacts.toLocaleString()}
                        </td>

                        <td className="py-3.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                          {c._count.callAttempts.toLocaleString()}
                        </td>

                        <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap text-xs font-mono">
                          {c.callerPhoneNumber || "—"}
                        </td>

                        <td className="py-3.5 px-4 text-slate-500 text-xs whitespace-nowrap">
                          {new Date(c.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <Link href={`/campaigns/${c.id}`}>
                            <Button
                              size="xs"
                              variant="secondary"
                              icon={<ArrowRight className="w-3.5 h-3.5" />}
                            >
                              View
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>

        {/* Create Campaign Modal */}
        <CreateCampaignModal
          isOpen={isCreateCampaignOpen}
          onClose={() => setIsCreateCampaignOpen(false)}
          onCreated={() => {
            setRefreshTrigger((p) => p + 1);
            setIsCreateCampaignOpen(false);
          }}
        />
      </div>
    </DashboardLayout>
  );
}

export default function CompanyDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CompanyDetailContent params={props.params} />
    </Suspense>
  );
}
