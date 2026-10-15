"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { CampaignList, CampaignListItem } from "@/components/CampaignList";
import { CreateCampaignModal } from "@/components/CreateCampaignModal";
import { UploadCohortModal } from "@/components/UploadCohortModal";
import { Megaphone, Activity, Users, PhoneCall, Plus, ShieldCheck, Zap, RefreshCw } from "lucide-react";

export default function Home() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCohortCampaign, setSelectedCohortCampaign] = useState<CampaignListItem | null>(null);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/campaigns?page=1&limit=50");
        const result = await res.json();
        if (!ignore && result.success && result.data) {
          setCampaigns(result.data.items);
        }
      } catch (err) {
        console.error("Error fetching campaigns:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [refreshTrigger]);

  const handleRefresh = () => {
    setLoading(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  // Derived dashboard metrics
  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter(
    (c) => c.status === "RUNNING" || c.status === "SCHEDULED"
  ).length;
  const totalContacts = campaigns.reduce(
    (acc, curr) => acc + (curr._count?.contacts || 0),
    0
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Campaign Manager
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Autonomous outbound AI voice calling campaigns with Sarvam AI integration.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shadow-2xs"
              title="Refresh campaigns"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Campaign
            </button>
          </div>
        </div>

        {/* System Capabilities Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-3 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Rate Limiter</p>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Org-wide Token Bucket (60 req/min)</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="p-2 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-lg">
              <PhoneCall className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Voice Provider</p>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Sarvam Outbound Voice API</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="p-2 bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded-lg">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Multi-Tenancy</p>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">PostgreSQL Multi-Tenant Scoped</p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <section aria-label="Dashboard Metrics">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Campaigns"
              value={totalCampaigns}
              description="Configured across workspace"
              icon={Megaphone}
            />
            <StatCard
              title="Active Campaigns"
              value={activeCampaigns}
              description="Running or scheduled calls"
              icon={Activity}
            />
            <StatCard
              title="Total Contacts"
              value={totalContacts}
              description="Imported from cohorts"
              icon={Users}
            />
            <StatCard
              title="Calls Completed"
              value={0}
              description="Outbound call attempts logged"
              icon={PhoneCall}
            />
          </div>
        </section>

        {/* Campaigns List or Empty State */}
        <section aria-label="Campaigns List" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Campaigns
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {campaigns.length} campaigns configured
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-sm text-zinc-500 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
              Loading campaigns from PostgreSQL...
            </div>
          ) : campaigns.length === 0 ? (
            <EmptyState onCreateCampaign={() => setIsCreateOpen(true)} />
          ) : (
            <CampaignList
              campaigns={campaigns}
              onUploadCohort={(campaign) => setSelectedCohortCampaign(campaign)}
            />
          )}
        </section>
      </main>

      {/* Modals */}
      <CreateCampaignModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleRefresh}
      />

      {selectedCohortCampaign && (
        <UploadCohortModal
          isOpen={!!selectedCohortCampaign}
          campaignId={selectedCohortCampaign.id}
          campaignName={selectedCohortCampaign.name}
          requiredVariables={selectedCohortCampaign.requiredVariables}
          onClose={() => setSelectedCohortCampaign(null)}
          onSuccess={handleRefresh}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Campaign Manager &bull; Sarvam AI Voice Outbound Platform
      </footer>
    </div>
  );
}
