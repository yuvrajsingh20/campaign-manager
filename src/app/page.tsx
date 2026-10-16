"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Megaphone,
  Activity,
  Users,
  PhoneCall,
  Plus,
  RefreshCw,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { AuthUser, DashboardStats } from "@/types";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { CampaignList, CampaignListItem } from "@/components/CampaignList";
import { CreateCampaignModal } from "@/components/CreateCampaignModal";
import { UploadCohortModal } from "@/components/UploadCohortModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [metrics, setMetrics] = useState<DashboardStats>({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalContacts: 0,
    completedCalls: 0,
    failedCalls: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCohortCampaign, setSelectedCohortCampaign] = useState<CampaignListItem | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Authenticate user & load campaigns
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
        if (!ignore && meData?.success && meData.data?.user) {
          setCurrentUser(meData.data.user);
        }

        const res = await fetch("/api/campaigns?page=1&limit=50");
        if (res.status === 401) {
          router.push("/login");
          return;
        }

        const result = await res.json();
        if (!ignore && result.success && result.data) {
          setCampaigns(result.data.items);
          if (result.data.metrics) {
            setMetrics(result.data.metrics);
          }
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
  }, [refreshTrigger, router]);

  const handleRefresh = () => {
    setLoading(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  const orgRps = currentUser?.organization?.maxRequestsPerSecond ?? 5.0;

  return (
    <DashboardLayout
      breadcrumbs={[{ label: "Campaigns" }]}
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
            onClick={() => setIsCreateOpen(true)}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Create campaign
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {currentUser?.organization
                  ? `${currentUser.organization.name}`
                  : "Voice Campaigns"}
              </h1>
              {currentUser?.organization?.status && (
                <Badge status={currentUser.organization.status} dot />
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Autonomous outbound AI agent call execution, dynamic cohort upload, and distributed sliding window rate limiting.
            </p>
          </div>
        </div>

        {/* Operational System Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-medium text-slate-500 block">
                Rate limiter (sliding window)
              </span>
              <strong className="text-xs font-semibold text-slate-900">
                {orgRps} req/sec ceiling
              </strong>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0">
              <PhoneCall className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-medium text-slate-500 block">
                Telephony provider
              </span>
              <strong className="text-xs font-semibold text-slate-900">
                Sarvam AI Voice API
              </strong>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-medium text-slate-500 block">
                Calling window policy
              </span>
              <strong className="text-xs font-semibold text-slate-900">
                Local Timezone Active
              </strong>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
          <StatCard
            title="Total campaigns"
            value={metrics.totalCampaigns}
            description="Created voice campaigns"
            icon={Megaphone}
            iconColor="blue"
          />
          <StatCard
            title="Active campaigns"
            value={metrics.activeCampaigns}
            description="Currently running"
            icon={Activity}
            iconColor="emerald"
          />
          <StatCard
            title="Pipeline contacts"
            value={metrics.totalContacts.toLocaleString()}
            description="Audience records loaded"
            icon={Users}
            iconColor="purple"
          />
          <StatCard
            title="Completed calls"
            value={metrics.completedCalls.toLocaleString()}
            description="Successfully answered"
            icon={CheckCircle2}
            iconColor="emerald"
          />
          <StatCard
            title="Failed calls"
            value={metrics.failedCalls.toLocaleString()}
            description="Exhausted or DNC"
            icon={XCircle}
            iconColor="slate"
          />
        </div>

        {/* Campaigns Table Section */}
        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                All campaigns
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                {campaigns.length}
              </span>
            </div>
          </div>

          {campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns found"
              description="No voice campaigns have been created yet. Set up a campaign with an agent configuration, dialing schedule, and cohort to begin."
              icon={Megaphone}
              actionLabel="Create first campaign"
              onCreateCampaign={() => setIsCreateOpen(true)}
            />
          ) : (
            <CampaignList
              campaigns={campaigns}
              onUploadCohort={(campaign) => setSelectedCohortCampaign(campaign)}
            />
          )}
        </section>

        {/* Modals */}
        <CreateCampaignModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleRefresh}
        />

        {selectedCohortCampaign && (
          <UploadCohortModal
            isOpen={Boolean(selectedCohortCampaign)}
            campaignId={selectedCohortCampaign.id}
            campaignName={selectedCohortCampaign.name}
            requiredVariables={selectedCohortCampaign.requiredVariables}
            onClose={() => setSelectedCohortCampaign(null)}
            onSuccess={handleRefresh}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
