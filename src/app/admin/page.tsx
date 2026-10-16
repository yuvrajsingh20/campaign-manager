"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { StatCard } from "@/components/StatCard";
import { OnboardCompanyModal } from "@/components/OnboardCompanyModal";
import {
  Building2,
  FolderTree,
  Megaphone,
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Zap,
  CheckCircle2,
  XCircle,
  Edit2,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { AuthUser } from "@/types";

interface CompanyItem {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  maxRequestsPerSecond: number;
  rateLimitPerMinute: number;
  createdAt: string;
  _count: {
    users: number;
    workspaces: number;
    campaigns: number;
  };
  users: Array<{
    id: string;
    email: string;
    name: string | null;
  }>;
}

interface AdminMetrics {
  totalCompanies: number;
  totalWorkspaces: number;
  totalCampaigns: number;
}

export default function SuperadminDashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [metrics, setMetrics] = useState<AdminMetrics>({
    totalCompanies: 0,
    totalWorkspaces: 0,
    totalCampaigns: 0,
  });
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Inline editing of RPS limit
  const [editingRpsId, setEditingRpsId] = useState<string | null>(null);
  const [editingRpsValue, setEditingRpsValue] = useState<number>(5.0);
  const [updatingRps, setUpdatingRps] = useState(false);

  // Status updating state
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  // 1. Authenticate user as Superadmin
  useEffect(() => {
    let ignore = false;
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error("Unauthenticated");
        return res.json();
      })
      .then((data) => {
        if (!ignore && data?.success && data?.data?.user) {
          const user = data.data.user;
          setCurrentUser(user);
          if (user.role !== "SUPERADMIN") {
            router.push("/");
          }
        }
      })
      .catch(() => {
        if (!ignore) router.push("/login");
      })
      .finally(() => {
        if (!ignore) setAuthChecked(true);
      });

    return () => {
      ignore = true;
    };
  }, [router]);

  // 2. Fetch metrics and companies
  useEffect(() => {
    if (!authChecked || currentUser?.role !== "SUPERADMIN") return;

    let ignore = false;
    async function loadData() {
      setLoading(true);
      try {
        const [metricsRes, companiesRes] = await Promise.all([
          fetch("/api/admin/metrics"),
          fetch(`/api/admin/companies${search ? `?search=${encodeURIComponent(search)}` : ""}`),
        ]);

        const [metricsData, companiesData] = await Promise.all([
          metricsRes.json(),
          companiesRes.json(),
        ]);

        if (!ignore) {
          if (metricsData?.success && metricsData.data) {
            setMetrics(metricsData.data);
          }
          if (companiesData?.success && companiesData.data) {
            setCompanies(companiesData.data);
          }
        }
      } catch (err) {
        console.error("Failed to load admin data:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [authChecked, currentUser, search, refreshTrigger]);

  const handleToggleStatus = async (company: CompanyItem) => {
    const nextStatus = company.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setUpdatingStatusId(company.id);

    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const result = await res.json();
      if (res.ok && result.success) {
        setCompanies((prev) =>
          prev.map((c) => (c.id === company.id ? { ...c, status: nextStatus } : c))
        );
      } else {
        alert(result?.error?.message || "Failed to update company status");
      }
    } catch (err) {
      console.error("Status update error:", err);
      alert("Error updating status");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleSaveRps = async (companyId: string) => {
    setUpdatingRps(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxRequestsPerSecond: editingRpsValue }),
      });

      const result = await res.json();
      if (res.ok && result.success) {
        setCompanies((prev) =>
          prev.map((c) =>
            c.id === companyId
              ? {
                  ...c,
                  maxRequestsPerSecond: result.data.maxRequestsPerSecond,
                  rateLimitPerMinute: result.data.rateLimitPerMinute,
                }
              : c
          )
        );
        setEditingRpsId(null);
      } else {
        alert(result?.error?.message || "Failed to update RPS limit");
      }
    } catch (err) {
      console.error("RPS update error:", err);
      alert("Error updating RPS limit");
    } finally {
      setUpdatingRps(false);
    }
  };

  if (!authChecked || currentUser?.role !== "SUPERADMIN") {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                Superadmin
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                Multi-Tenant Company Management
              </h1>
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Provision companies, manage tenant isolation, and configure global voice calling limits.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setRefreshTrigger((prev) => prev + 1)}
              className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 shadow-2xs transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setIsOnboardOpen(true)}
              className="inline-flex items-center px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-2" />
              Onboard Company
            </button>
          </div>
        </div>

        {/* Real Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <StatCard
            title="Companies Onboarded"
            value={metrics.totalCompanies}
            icon={Building2}
            description="Active & configured tenant organisations"
          />
          <StatCard
            title="Total Workspaces"
            value={metrics.totalWorkspaces}
            icon={FolderTree}
            description="Isolated workspace partitions"
          />
          <StatCard
            title="Total Campaigns"
            value={metrics.totalCampaigns}
            icon={Megaphone}
            description="Cross-tenant voice outreach operations"
          />
        </div>

        {/* Company List Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xs overflow-hidden">
          {/* Search bar & count */}
          <div className="p-4 sm:p-6 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                Onboarded Companies ({companies.length})
              </h2>
              <p className="text-xs text-zinc-500">Live multi-tenant company directory</p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Search companies by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="py-3 px-4 sm:px-6">Company</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Owner</th>
                  <th className="py-3 px-4">Users</th>
                  <th className="py-3 px-4">Campaigns</th>
                  <th className="py-3 px-4">Permitted RPS</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {companies.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-zinc-500 text-sm">
                      {loading ? "Loading companies..." : "No companies found."}
                    </td>
                  </tr>
                ) : (
                  companies.map((company) => {
                    const isEditingRps = editingRpsId === company.id;
                    const isUpdatingStatus = updatingStatusId === company.id;
                    const owner = company.users?.[0];

                    return (
                      <tr
                        key={company.id}
                        className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors"
                      >
                        <td className="py-4 px-4 sm:px-6 font-medium text-zinc-900 dark:text-zinc-100">
                          <div>
                            <Link
                              href={`/admin/companies/${company.id}`}
                              className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {company.name}
                            </Link>
                            <div className="text-xs text-zinc-400 font-mono">/{company.slug}</div>
                          </div>
                        </td>

                        <td className="py-4 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(company)}
                            disabled={isUpdatingStatus}
                            title="Click to toggle status"
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                              company.status === "ACTIVE"
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-300"
                            }`}
                          >
                            {isUpdatingStatus ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : company.status === "ACTIVE" ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <XCircle className="w-3 h-3" />
                            )}
                            <span>{company.status}</span>
                          </button>
                        </td>

                        <td className="py-4 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                          {owner ? (
                            <div>
                              <div className="font-medium text-zinc-800 dark:text-zinc-200">
                                {owner.name || "Owner"}
                              </div>
                              <div className="text-zinc-400">{owner.email}</div>
                            </div>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>

                        <td className="py-4 px-4 text-zinc-600 dark:text-zinc-400 text-xs">
                          {company._count.users}
                        </td>

                        <td className="py-4 px-4 text-zinc-600 dark:text-zinc-400 text-xs">
                          {company._count.campaigns}
                        </td>

                        <td className="py-4 px-4">
                          {isEditingRps ? (
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="100"
                                value={editingRpsValue}
                                onChange={(e) => setEditingRpsValue(parseFloat(e.target.value))}
                                className="w-16 px-1.5 py-1 text-xs border rounded bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600"
                              />
                              <button
                                onClick={() => handleSaveRps(company.id)}
                                disabled={updatingRps}
                                className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setEditingRpsId(null)}
                                className="p-1 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2 text-xs">
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center">
                                <Zap className="w-3.5 h-3.5 text-amber-500 mr-1" />
                                {company.maxRequestsPerSecond} RPS
                              </span>
                              <button
                                onClick={() => {
                                  setEditingRpsId(company.id);
                                  setEditingRpsValue(company.maxRequestsPerSecond);
                                }}
                                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                                title="Edit RPS limit"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="py-4 px-4 text-xs text-zinc-500">
                          {new Date(company.createdAt).toLocaleDateString()}
                        </td>

                        <td className="py-4 px-4 sm:px-6 text-right">
                          <Link
                            href={`/admin/companies/${company.id}`}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <OnboardCompanyModal
        isOpen={isOnboardOpen}
        onClose={() => setIsOnboardOpen(false)}
        onSuccess={() => {
          setRefreshTrigger((prev) => prev + 1);
        }}
      />
    </div>
  );
}
