"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  FolderTree,
  Megaphone,
  Search,
  Plus,
  RefreshCw,
  Edit2,
  Check,
  X,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { AuthUser } from "@/types";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";
import { OnboardCompanyModal } from "@/components/OnboardCompanyModal";

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
          fetch(
            `/api/admin/companies${
              search ? `?search=${encodeURIComponent(search)}` : ""
            }`
          ),
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
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleSaveRps = async (companyId: string) => {
    if (editingRpsValue <= 0) return;
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
      }
    } catch (err) {
      console.error("Failed to update RPS:", err);
    } finally {
      setUpdatingRps(false);
    }
  };

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  if (!authChecked || currentUser?.role !== "SUPERADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Verifying administrator credentials...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      breadcrumbs={[{ label: "Organisations" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            icon={
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            }
          >
            Refresh
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsOnboardOpen(true)}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Onboard organisation
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Organisations
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Provision tenant organisations, manage outbound rate limit ceilings, workspaces, and system campaigns.
            </p>
          </div>
        </div>

        {/* Global Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Total organisations"
            value={metrics.totalCompanies}
            description="Tenant organisations registered"
            icon={Building2}
            iconColor="blue"
          />
          <StatCard
            title="Total workspaces"
            value={metrics.totalWorkspaces}
            description="Tenant isolation partitions"
            icon={FolderTree}
            iconColor="purple"
          />
          <StatCard
            title="Global campaigns"
            value={metrics.totalCampaigns}
            description="Campaigns across all tenants"
            icon={Megaphone}
            iconColor="emerald"
          />
        </div>

        {/* Search and Table Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Tenant list
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                {companies.length}
              </span>
            </div>

            <div className="relative w-full sm:w-72">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or slug..."
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2" />
            </div>
          </div>

          {companies.length === 0 ? (
            <EmptyState
              title={search ? "No organisations match your search" : "No organisations found"}
              description={
                search
                  ? `No organisations match "${search}". Try searching by a different name or slug.`
                  : "Onboard your first customer organisation to provision workspaces and start campaigns."
              }
              icon={Building2}
              actionLabel="Onboard organisation"
              onCreateCampaign={() => setIsOnboardOpen(true)}
            />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-xs font-semibold">
                    <tr>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Organisation</th>
                      <th className="py-3 px-4">Rate limit</th>
                      <th className="py-3 px-4">Workspaces</th>
                      <th className="py-3 px-4">Campaigns</th>
                      <th className="py-3 px-4">Administrator</th>
                      <th className="py-3 px-4">Onboarded</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {companies.map((company) => (
                      <tr
                        key={company.id}
                        className="hover:bg-slate-50/60 transition-colors"
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(company)}
                            disabled={updatingStatusId === company.id}
                            title="Click to toggle active/inactive status"
                            className="cursor-pointer"
                          >
                            {updatingStatusId === company.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                            ) : (
                              <Badge status={company.status} dot />
                            )}
                          </button>
                        </td>

                        <td className="py-3.5 px-4">
                          <Link
                            href={`/admin/companies/${company.id}`}
                            className="font-medium text-slate-900 hover:text-blue-600 transition-colors"
                          >
                            {company.name}
                          </Link>
                          <div className="text-xs text-slate-400 font-mono mt-0.5">
                            /{company.slug}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {editingRpsId === company.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="100"
                                value={editingRpsValue}
                                onChange={(e) =>
                                  setEditingRpsValue(parseFloat(e.target.value))
                                }
                                className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900"
                              />
                              <Button
                                size="xs"
                                variant="primary"
                                onClick={() => handleSaveRps(company.id)}
                                isLoading={updatingRps}
                                icon={<Check className="w-3 h-3" />}
                              />
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => setEditingRpsId(null)}
                                icon={<X className="w-3 h-3" />}
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800 text-xs">
                                {company.maxRequestsPerSecond} req/s
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRpsId(company.id);
                                  setEditingRpsValue(company.maxRequestsPerSecond);
                                }}
                                className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors cursor-pointer"
                                title="Edit rate limit"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                          {company._count.workspaces}
                        </td>

                        <td className="py-3.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                          {company._count.campaigns}
                        </td>

                        <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap text-xs">
                          {company.users[0]?.email || "—"}
                        </td>

                        <td className="py-3.5 px-4 text-slate-500 text-xs whitespace-nowrap">
                          {new Date(company.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <Link href={`/admin/companies/${company.id}`}>
                            <Button
                              size="xs"
                              variant="secondary"
                              icon={<ArrowRight className="w-3.5 h-3.5" />}
                            >
                              Manage
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
        </div>

        {/* Onboard Modal */}
        <OnboardCompanyModal
          isOpen={isOnboardOpen}
          onClose={() => setIsOnboardOpen(false)}
          onSuccess={() => {
            handleRefresh();
            setIsOnboardOpen(false);
          }}
        />
      </div>
    </DashboardLayout>
  );
}
