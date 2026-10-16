"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  Phone,
  Clock,
  RotateCcw,
  Building2,
  Save,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface CampaignData {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  agentAppId?: string | null;
  agentVersion?: string | null;
  sarvamAgentId?: string | null;
  connectionId?: string | null;
  callerPhoneNumber?: string | null;
  maxRequestsPerSecond: number;
  dailyStartTime?: string | null;
  dailyEndTime?: string | null;
  timezone: string;
  allowedDays: string[];
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  maxRetries: number;
  retryIntervalMinutes: number;
  retryOnBusy: boolean;
  retryOnNoAnswer: boolean;
  retryOnShortDuration: boolean;
  shortDurationThresholdSeconds: number;
  requiredVariables: string[];
}

interface EditCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  campaign: CampaignData;
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

function EditCampaignModalContent({
  onClose,
  onUpdated,
  campaign,
}: {
  onClose: () => void;
  onUpdated: () => void;
  campaign: CampaignData;
}) {
  const [activeTab, setActiveTab] = useState<"general" | "telephony" | "schedule" | "retries">("general");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State initialized directly from campaign props upon mount
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description || "");

  const [agentAppId, setAgentAppId] = useState(campaign.agentAppId || "");
  const [agentVersion, setAgentVersion] = useState(campaign.agentVersion || "1");
  const [sarvamAgentId, setSarvamAgentId] = useState(campaign.sarvamAgentId || "");
  const [connectionId, setConnectionId] = useState(campaign.connectionId || "");
  const [callerPhoneNumber, setCallerPhoneNumber] = useState(campaign.callerPhoneNumber || "");

  const [timezone, setTimezone] = useState(campaign.timezone || "UTC");
  const [dailyStartTime, setDailyStartTime] = useState(campaign.dailyStartTime || "09:00");
  const [dailyEndTime, setDailyEndTime] = useState(campaign.dailyEndTime || "18:00");
  const [allowedDays, setAllowedDays] = useState<string[]>(
    campaign.allowedDays && campaign.allowedDays.length > 0
      ? campaign.allowedDays
      : ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
  );
  const [scheduledStartTime, setScheduledStartTime] = useState(
    campaign.scheduledStartTime ? campaign.scheduledStartTime.slice(0, 16) : ""
  );
  const [scheduledEndTime, setScheduledEndTime] = useState(
    campaign.scheduledEndTime ? campaign.scheduledEndTime.slice(0, 16) : ""
  );

  const [maxRequestsPerSecond, setMaxRequestsPerSecond] = useState(campaign.maxRequestsPerSecond || 5.0);
  const [maxRetries, setMaxRetries] = useState(campaign.maxRetries ?? 3);
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState(campaign.retryIntervalMinutes ?? 30);
  const [retryOnBusy, setRetryOnBusy] = useState(campaign.retryOnBusy ?? true);
  const [retryOnNoAnswer, setRetryOnNoAnswer] = useState(campaign.retryOnNoAnswer ?? true);
  const [retryOnShortDuration, setRetryOnShortDuration] = useState(campaign.retryOnShortDuration ?? true);
  const [shortDurationThresholdSeconds, setShortDurationThresholdSeconds] = useState(
    campaign.shortDurationThresholdSeconds ?? 15
  );
  const [requiredVariablesInput, setRequiredVariablesInput] = useState(
    (campaign.requiredVariables || []).join(", ")
  );

  const toggleDay = (day: string) => {
    setAllowedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage("Campaign name is required.");
      return;
    }
    if (allowedDays.length === 0) {
      setErrorMessage("Please select at least one permitted calling day.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const requiredVariables = requiredVariablesInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      agentAppId: agentAppId.trim() || null,
      agentVersion: agentVersion.trim() || "1",
      sarvamAgentId: sarvamAgentId.trim() || null,
      connectionId: connectionId.trim() || null,
      callerPhoneNumber: callerPhoneNumber.trim() || null,
      maxRequestsPerSecond: Number(maxRequestsPerSecond) || 5.0,
      dailyStartTime,
      dailyEndTime,
      timezone: timezone.trim() || "UTC",
      allowedDays,
      scheduledStartTime: scheduledStartTime
        ? new Date(scheduledStartTime).toISOString()
        : null,
      scheduledEndTime: scheduledEndTime
        ? new Date(scheduledEndTime).toISOString()
        : null,
      maxRetries: Number(maxRetries) || 0,
      retryIntervalMinutes: Number(retryIntervalMinutes) || 1,
      retryOnBusy,
      retryOnNoAnswer,
      retryOnShortDuration,
      shortDurationThresholdSeconds: Number(shortDurationThresholdSeconds) || 15,
      requiredVariables,
    };

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || "Failed to update campaign configuration");
      }

      onUpdated();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Edit campaign configuration"
      description="Update voice agent parameters, calling windows, retry behavior, and rate limits."
      maxWidth="3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-slate-200 pb-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === "general"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            General
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("telephony")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === "telephony"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            Agent & Telephony
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === "schedule"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Calling Window
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("retries")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === "retries"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Rate Limit & Retries
          </button>
        </div>

        {errorMessage && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <span className="font-semibold">Update failed:</span> {errorMessage}
            </div>
          </div>
        )}

        {/* Tab 1: General */}
        {activeTab === "general" && (
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
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Campaign description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly state the goal or context for this campaign..."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Required cohort variables (comma separated)
              </label>
              <input
                type="text"
                value={requiredVariablesInput}
                onChange={(e) => setRequiredVariablesInput(e.target.value)}
                placeholder="e.g. customer_name, renewal_amount, due_date"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Uploaded customer CSV files will be validated to guarantee these variables exist.
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Telephony */}
        {activeTab === "telephony" && (
          <div className="space-y-4">
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
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
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
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
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
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Telephony connection ID
                </label>
                <input
                  type="text"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  placeholder="conn_enterprise_trunk"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
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
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 font-mono text-xs"
              />
            </div>
          </div>
        )}

        {/* Tab 3: Schedule */}
        {activeTab === "schedule" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Campaign timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
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
                  Daily start time (HH:mm)
                </label>
                <input
                  type="time"
                  required
                  value={dailyStartTime}
                  onChange={(e) => setDailyStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Daily end time (HH:mm)
                </label>
                <input
                  type="time"
                  required
                  value={dailyEndTime}
                  onChange={(e) => setDailyEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
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
                  Scheduled start date/time
                </label>
                <input
                  type="datetime-local"
                  value={scheduledStartTime}
                  onChange={(e) => setScheduledStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Scheduled end date/time
                </label>
                <input
                  type="datetime-local"
                  value={scheduledEndTime}
                  onChange={(e) => setScheduledEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Rate limit & Retries */}
        {activeTab === "retries" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Rate limit ceiling (requests/sec)
              </label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                max="50"
                required
                value={maxRequestsPerSecond}
                onChange={(e) => setMaxRequestsPerSecond(parseFloat(e.target.value) || 1)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
              />
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
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
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
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
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

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={submitting}
            icon={<Save className="w-4 h-4" />}
          >
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function EditCampaignModal({
  isOpen,
  onClose,
  onUpdated,
  campaign,
}: EditCampaignModalProps) {
  if (!isOpen) return null;
  return (
    <EditCampaignModalContent
      key={`${campaign.id}-${campaign.status}`}
      campaign={campaign}
      onClose={onClose}
      onUpdated={onUpdated}
    />
  );
}
