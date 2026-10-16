"use client";

import React, { useState, useEffect } from "react";
import {
  AlertCircle,
  Building2,
  Phone,
  Clock,
  RotateCcw,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface WorkspaceOption {
  id: string;
  name: string;
  organization: {
    name: string;
    maxRequestsPerSecond: number;
  };
}

// Module-level cache to keep workspaces available instantly without re-fetching delays
let cachedWorkspaces: WorkspaceOption[] | null = null;

interface CreateCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const ALL_DAYS = [
  { key: "MONDAY", label: "Mon" },
  { key: "TUESDAY", label: "Tue" },
  { key: "WEDNESDAY", label: "Wed" },
  { key: "THURSDAY", label: "Thu" },
  { key: "FRIDAY", label: "Fri" },
  { key: "SATURDAY", label: "Sat" },
  { key: "SUNDAY", label: "Sun" },
] as const;

const STEPS = [
  { id: 1, title: "Campaign details", icon: Building2 },
  { id: 2, title: "Agent & telephony", icon: Phone },
  { id: 3, title: "Calling window", icon: Clock },
  { id: 4, title: "Rate limit & retries", icon: RotateCcw },
  { id: 5, title: "Review & create", icon: CheckCircle2 },
];

export function CreateCampaignModal({
  isOpen,
  onClose,
  onCreated,
}: CreateCampaignModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>(() => cachedWorkspaces ?? []);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(() => !cachedWorkspaces);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State: Step 1 (Identity & Workspace)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workspaceId, setWorkspaceId] = useState(() => cachedWorkspaces?.[0]?.id ?? "");

  // Step 2: Agent configuration & Telephony
  const [agentAppId, setAgentAppId] = useState("");
  const [agentVersion, setAgentVersion] = useState("1");
  const [sarvamAgentId, setSarvamAgentId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [callerPhoneNumber, setCallerPhoneNumber] = useState("");

  // Step 3: Schedule & Calling Window
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [dailyStartTime, setDailyStartTime] = useState("09:00");
  const [dailyEndTime, setDailyEndTime] = useState("18:00");
  const [allowedDays, setAllowedDays] = useState<string[]>([
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
  ]);
  const [scheduledStartTime, setScheduledStartTime] = useState("");
  const [scheduledEndTime, setScheduledEndTime] = useState("");

  // Step 4: Rate limit & Retries
  const [maxRequestsPerSecond, setMaxRequestsPerSecond] = useState(5.0);
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState(30);
  const [retryOnBusy, setRetryOnBusy] = useState(true);
  const [retryOnNoAnswer, setRetryOnNoAnswer] = useState(true);
  const [retryOnShortDuration, setRetryOnShortDuration] = useState(true);
  const [shortDurationThresholdSeconds, setShortDurationThresholdSeconds] = useState(15);

  // Step 5: Cohort dynamic variables
  const [requiredVariablesInput, setRequiredVariablesInput] = useState("");

  useEffect(() => {
    let ignore = false;
    if (isOpen) {
      async function loadWorkspaces() {
        try {
          if (!cachedWorkspaces) {
            setLoadingWorkspaces(true);
          }
          const res = await fetch("/api/workspaces");
          const data = await res.json();
          if (!ignore && data.success && Array.isArray(data.data)) {
            cachedWorkspaces = data.data;
            setWorkspaces(data.data);
            if (data.data.length > 0) {
              setWorkspaceId((prev) => (prev ? prev : data.data[0].id));
            }
          }
        } catch (err) {
          console.error("Error loading workspaces:", err);
        } finally {
          if (!ignore) setLoadingWorkspaces(false);
        }
      }
      loadWorkspaces();
    }
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId);
  const orgLimit = selectedWorkspace?.organization?.maxRequestsPerSecond ?? 5.0;

  const toggleDay = (day: string) => {
    setAllowedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const validateCurrentStep = (): boolean => {
    setErrorMessage(null);
    if (currentStep === 1) {
      if (!name.trim()) {
        setErrorMessage("Please enter a campaign name.");
        return false;
      }
      if (!workspaceId) {
        setErrorMessage("Please select a target workspace.");
        return false;
      }
    } else if (currentStep === 3) {
      if (allowedDays.length === 0) {
        setErrorMessage("Please select at least one allowed calling day.");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateCurrentStep()) {
      setCurrentStep((prev) => Math.min(STEPS.length, prev + 1));
    }
  };

  const handlePrev = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validateCurrentStep()) return;

    setSubmitting(true);
    setErrorMessage(null);

    const requiredVariables = requiredVariablesInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      workspaceId,
      agentAppId: agentAppId.trim() || undefined,
      agentVersion: agentVersion.trim() || "1",
      agentType: "agent",
      sarvamAgentId: sarvamAgentId.trim() || undefined,
      connectionId: connectionId.trim() || undefined,
      callerPhoneNumber: callerPhoneNumber.trim() || undefined,
      maxRequestsPerSecond: Number(maxRequestsPerSecond) || 5.0,

      dailyStartTime,
      dailyEndTime,
      timezone: timezone.trim() || "UTC",
      allowedDays,
      scheduledStartTime: scheduledStartTime
        ? new Date(scheduledStartTime).toISOString()
        : undefined,
      scheduledEndTime: scheduledEndTime
        ? new Date(scheduledEndTime).toISOString()
        : undefined,

      maxRetries: Number(maxRetries) || 3,
      retryIntervalMinutes: Number(retryIntervalMinutes) || 30,
      retryOnBusy,
      retryOnNoAnswer,
      retryOnShortDuration,
      shortDurationThresholdSeconds: Number(shortDurationThresholdSeconds) || 15,

      requiredVariables,
      status: "DRAFT",
    };

    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || "Failed to create campaign");
      }

      onCreated();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create outbound campaign"
      description="Configure voice agent parameters, calling window, retry behavior, and cohort settings."
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {/* Step Progress Bar */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 overflow-x-auto gap-2 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {STEPS.map((step) => {
            const Icon = step.icon;
            const isCurrent = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  if (step.id < currentStep || validateCurrentStep()) {
                    setCurrentStep(step.id);
                  }
                }}
                className={`flex items-center gap-1.5 sm:gap-2 py-1 px-2 sm:px-2.5 rounded-lg text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                  isCurrent
                    ? "bg-blue-50 text-blue-700"
                    : isCompleted
                    ? "text-emerald-700 hover:bg-slate-50"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <div
                  className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
                    isCurrent
                      ? "bg-blue-600 text-white"
                      : isCompleted
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {isCompleted ? "✓" : <Icon className="w-3 h-3" />}
                </div>
                <span className="whitespace-nowrap">{step.title}</span>
              </button>
            );
          })}
        </div>

        {errorMessage && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <span className="font-semibold">Error:</span> {errorMessage}
            </div>
          </div>
        )}

        {/* Step 1: Campaign details */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Campaign name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q4 Renewal Voice Outreach"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Target workspace *
              </label>
              {loadingWorkspaces && workspaces.length === 0 ? (
                <div className="relative">
                  <select
                    disabled
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-400 cursor-not-allowed appearance-none"
                  >
                    <option>Loading workspaces...</option>
                  </select>
                  <div className="absolute right-3 top-2.5">
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  </div>
                </div>
              ) : workspaces.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center justify-between">
                  <span>No workspaces found for your account.</span>
                  <button
                    type="button"
                    onClick={() => {
                      cachedWorkspaces = null;
                      setLoadingWorkspaces(true);
                      fetch("/api/workspaces")
                        .then((r) => r.json())
                        .then((d) => {
                          if (d?.success && Array.isArray(d?.data)) {
                            cachedWorkspaces = d.data;
                            setWorkspaces(d.data);
                            if (d.data.length > 0) setWorkspaceId(d.data[0].id);
                          }
                        })
                        .catch(console.error)
                        .finally(() => setLoadingWorkspaces(false));
                    }}
                    className="font-medium text-amber-900 underline hover:text-amber-950 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name} ({ws.organization.name})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Campaign description (optional)
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly state the goal or context for this outbound campaign..."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors resize-none"
              />
            </div>
          </div>
        )}

        {/* Step 2: Agent & Telephony */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Sarvam AI voice agents handle conversation flow. Enter your configured
                Agent App ID and telephony caller ID.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Sarvam Agent App ID
                </label>
                <input
                  type="text"
                  value={agentAppId}
                  onChange={(e) => setAgentAppId(e.target.value)}
                  placeholder="e.g. app_sales_assistant"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Agent version
                </label>
                <input
                  type="text"
                  value={agentVersion}
                  onChange={(e) => setAgentVersion(e.target.value)}
                  placeholder="1"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Caller phone number (E.164)
                </label>
                <input
                  type="text"
                  value={callerPhoneNumber}
                  onChange={(e) => setCallerPhoneNumber(e.target.value)}
                  placeholder="+919876543210"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Telephony connection ID (optional)
                </label>
                <input
                  type="text"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  placeholder="conn_enterprise_trunk"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Sarvam Agent ID (optional)
              </label>
              <input
                type="text"
                value={sarvamAgentId}
                onChange={(e) => setSarvamAgentId(e.target.value)}
                placeholder="agent_xxxxxxxx"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors font-mono text-xs"
              />
            </div>
          </div>
        )}

        {/* Step 3: Scheduling & Calling Window */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Campaign timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+05:30)</option>
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+04:00)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+08:00)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Daily start time
                </label>
                <input
                  type="time"
                  required
                  value={dailyStartTime}
                  onChange={(e) => setDailyStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Daily end time
                </label>
                <input
                  type="time"
                  required
                  value={dailyEndTime}
                  onChange={(e) => setDailyEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Permitted calling days
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_DAYS.map((day) => {
                  const selected = allowedDays.includes(day.key);
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => toggleDay(day.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        selected
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Scheduled start date/time (optional)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledStartTime}
                  onChange={(e) => setScheduledStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Scheduled end date/time (optional)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledEndTime}
                  onChange={(e) => setScheduledEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Rate limit & Retries */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Rate limit ceiling (requests/sec)
                </label>
                <span className="text-[11px] text-slate-500">
                  Organisation limit: <strong>{orgLimit} req/sec</strong>
                </span>
              </div>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max={orgLimit}
                required
                value={maxRequestsPerSecond}
                onChange={(e) => setMaxRequestsPerSecond(parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Sliding window rate limiter prevents exceeding telephony provider concurrency caps.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Max retries per lead
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  required
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Retry delay (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  required
                  value={retryIntervalMinutes}
                  onChange={(e) => setRetryIntervalMinutes(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-2 border-t border-slate-200">
              <span className="block text-xs font-medium text-slate-700">
                Retry triggers
              </span>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retryOnBusy}
                  onChange={(e) => setRetryOnBusy(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Retry if contact is busy</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retryOnNoAnswer}
                  onChange={(e) => setRetryOnNoAnswer(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Retry on no answer</span>
              </label>

              <div className="space-y-2">
                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={retryOnShortDuration}
                    onChange={(e) => setRetryOnShortDuration(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Retry calls shorter than threshold</span>
                </label>
                {retryOnShortDuration && (
                  <div className="pl-6 flex items-center gap-2 text-xs text-slate-600">
                    <span>Threshold:</span>
                    <input
                      type="number"
                      min="5"
                      max="120"
                      value={shortDurationThresholdSeconds}
                      onChange={(e) =>
                        setShortDurationThresholdSeconds(parseInt(e.target.value) || 15)
                      }
                      className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900"
                    />
                    <span>seconds</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Cohort dynamic variables & Review */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Required cohort variables (comma separated)
              </label>
              <input
                type="text"
                value={requiredVariablesInput}
                onChange={(e) => setRequiredVariablesInput(e.target.value)}
                placeholder="e.g. customer_name, renewal_amount, due_date"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Uploaded customer CSV files will be validated to guarantee these variables are present for each contact.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs">
              <span className="font-semibold text-slate-900 text-sm block border-b border-slate-200 pb-2">
                Configuration summary
              </span>
              <div className="grid grid-cols-2 gap-y-2 text-slate-600">
                <div>Campaign name:</div>
                <strong className="text-slate-900">{name || "—"}</strong>

                <div>Workspace:</div>
                <strong className="text-slate-900">
                  {selectedWorkspace?.name || "—"}
                </strong>

                <div>Calling window:</div>
                <span className="text-slate-900 font-medium">
                  {dailyStartTime} – {dailyEndTime} ({timezone})
                </span>

                <div>Rate limit ceiling:</div>
                <span className="text-slate-900 font-medium">
                  {maxRequestsPerSecond} requests/sec
                </span>

                <div>Allowed days:</div>
                <span className="text-slate-900 font-medium">
                  {allowedDays.map((d) => d.slice(0, 3)).join(", ")}
                </span>

                <div>Retry policy:</div>
                <span className="text-slate-900 font-medium">
                  Up to {maxRetries} attempts ({retryIntervalMinutes}m interval)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <div>
            {currentStep > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={handlePrev}
                icon={<ChevronLeft className="w-4 h-4" />}
              >
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {currentStep < STEPS.length ? (
              <Button
                type="button"
                variant="primary"
                onClick={handleNext}
                icon={<ChevronRight className="w-4 h-4" />}
              >
                Next step
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                isLoading={submitting}
                onClick={handleSubmit}
              >
                Create campaign
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
