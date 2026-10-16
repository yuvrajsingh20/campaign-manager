"use client";

import React, { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import {
  ArrowLeft,
  Building2,
  FolderTree,
  Users,
  Megaphone,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  AlertCircle,
  Save,
} from "lucide-react";

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

  // Editable settings
  const [rpsInput, setRpsInput] = useState<number>(5.0);
  const [savingRps, setSavingRps] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
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

    load();
    return () => {
      ignore = true;
    };
  }, [id, router]);

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
        setCompany((prev) => (prev ? { ...prev, maxRequestsPerSecond: data.data.maxRequestsPerSecond, rateLimitPerMinute: data.data.rateLimitPerMinute } : prev));
        setMessage({ text: "RPS limit updated successfully.", type: "success" });
      } else {
        setMessage({ text: data?.error?.message || "Failed to update RPS limit", type: "error" });
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
          text: `Company has been ${nextStatus === "ACTIVE" ? "activated" : "deactivated"}.`,
          type: "success",
        });
      } else {
        setMessage({ text: data?.error?.message || "Failed to update status", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error occurred", type: "error" });
    } finally {
      setTogglingStatus(false);
    }
  };

  if (loading || !company) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Navigation Breadcrumb */}
        <div>
          <Link
            href="/admin"
            className="inline-flex items-center text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back to Companies Directory
          </Link>
        </div>

        {/* Company Header */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 flex items-center justify-center shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {company.name}
                  </h1>
                  <span
                    className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      company.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                    }`}
                  >
                    {company.status === "ACTIVE" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    <span>{company.status}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center space-x-4 text-xs text-zinc-500">
                  <span>Slug: /{company.slug}</span>
                  <span>•</span>
                  <span>ID: {company.id}</span>
                  <span>•</span>
                  <span className="flex items-center">
                    <Calendar className="w-3.5 h-3.5 mr-1 text-zinc-400" />
                    Onboarded {new Date(company.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleToggleStatus}
                disabled={togglingStatus}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1.5 ${
                  company.status === "ACTIVE"
                    ? "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-900"
                    : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs"
                }`}
              >
                {togglingStatus && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                <span>{company.status === "ACTIVE" ? "Deactivate Company" : "Activate Company"}</span>
              </button>
            </div>
          </div>

          {message && (
            <div
              className={`mt-4 p-3 rounded-xl text-xs flex items-center space-x-2 ${
                message.type === "success"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200"
                  : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-200"
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{message.text}</span>
            </div>
          )}
        </div>

        {/* Configuration & Rate Limiting Form */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xs space-y-4">
            <div className="flex items-center space-x-2 text-zinc-900 dark:text-zinc-50 font-semibold text-sm">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>Organisation Rate Limiter</span>
            </div>
            <p className="text-xs text-zinc-500">
              Update the maximum simultaneous outgoing call requests permitted across all company campaigns.
            </p>

            <form onSubmit={handleUpdateRps} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Permitted RPS Limit (req/sec)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="200"
                  required
                  value={rpsInput}
                  onChange={(e) => setRpsInput(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl text-xs text-zinc-500 space-y-1">
                <div>Tokens Refill: Every rolling 1000ms</div>
                <div>Per Minute Equivalent: ~{Math.round(rpsInput * 60)} req/min</div>
              </div>

              <button
                type="submit"
                disabled={savingRps}
                className="w-full py-2 px-4 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
              >
                {savingRps ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    Save RPS Limit
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Associated Workspaces & Users */}
          <div className="md:col-span-2 space-y-6">
            {/* Workspaces */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-zinc-900 dark:text-zinc-50 font-semibold text-sm">
                  <FolderTree className="w-4 h-4 text-blue-500" />
                  <span>Workspaces ({company.workspaces.length})</span>
                </div>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                {company.workspaces.map((ws) => (
                  <div key={ws.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-zinc-800 dark:text-zinc-200">{ws.name}</div>
                      <div className="text-zinc-400 font-mono">/{ws.slug} • ID: {ws.id}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {ws._count.campaigns} campaigns
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Users */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-zinc-900 dark:text-zinc-50 font-semibold text-sm">
                  <Users className="w-4 h-4 text-purple-500" />
                  <span>Company Users ({company.users.length})</span>
                </div>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                {company.users.map((u) => (
                  <div key={u.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {u.name || "User"}
                      </div>
                      <div className="text-zinc-400">{u.email}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full font-bold uppercase bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      {u.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Campaigns List */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xs overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 flex items-center space-x-2">
              <Megaphone className="w-4 h-4 text-blue-600" />
              <span>Company Campaigns ({company.campaigns.length})</span>
            </h2>
            <p className="text-xs text-zinc-500">Outbound voice campaigns configured for this company</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="py-3 px-4 sm:px-6">Campaign Name</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Workspace</th>
                  <th className="py-3 px-4">Contacts</th>
                  <th className="py-3 px-4">Calls Made</th>
                  <th className="py-3 px-4">Caller ID</th>
                  <th className="py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                {company.campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      No campaigns created for this company yet.
                    </td>
                  </tr>
                ) : (
                  company.campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                      <td className="py-3.5 px-4 sm:px-6 font-semibold text-zinc-900 dark:text-zinc-100">
                        {c.name}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full font-semibold uppercase text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-500">{c.workspace.name}</td>
                      <td className="py-3.5 px-4 text-zinc-700 dark:text-zinc-300 font-medium">
                        {c._count.contacts}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-700 dark:text-zinc-300 font-medium">
                        {c._count.callAttempts}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-500">{c.callerPhoneNumber || "Default"}</td>
                      <td className="py-3.5 px-4 text-zinc-500">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CompanyDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
          <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 sticky top-0 z-50 h-16" />
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        </div>
      }
    >
      <CompanyDetailContent params={props.params} />
    </Suspense>
  );
}
