"use client";

import React, { useState } from "react";
import { Copy, AlertCircle, CheckCircle2, Check } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface OnboardCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface OnboardSuccessData {
  organization: {
    id: string;
    name: string;
    slug: string;
    maxRequestsPerSecond: number;
  };
  owner: {
    email: string;
    name: string;
  };
  temporaryPassword: string;
}

export function OnboardCompanyModal({
  isOpen,
  onClose,
  onSuccess,
}: OnboardCompanyModalProps) {
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [maxRequestsPerSecond, setMaxRequestsPerSecond] = useState(5.0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<OnboardSuccessData | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim(),
          maxRequestsPerSecond: Number(maxRequestsPerSecond) || 5.0,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data?.error?.message || "Failed to onboard organisation.");
        return;
      }

      setSuccessData(data.data);
      onSuccess();
    } catch (err) {
      console.error("Onboard error:", err);
      setErrorMessage("Network error occurred while onboarding organisation.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPassword = () => {
    if (successData?.temporaryPassword) {
      navigator.clipboard.writeText(successData.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResetAndClose = () => {
    setName("");
    setOwnerName("");
    setOwnerEmail("");
    setMaxRequestsPerSecond(5.0);
    setErrorMessage(null);
    setSuccessData(null);
    setCopied(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleResetAndClose}
      title={successData ? "Organisation provisioned" : "Onboard new organisation"}
      description={
        successData
          ? "The tenant organisation and owner credentials have been established."
          : "Provision a new tenant organisation, default workspace, and administrator account."
      }
      maxWidth="lg"
    >
      <div className="space-y-4">
        {errorMessage && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            <div>
              <span className="font-semibold">Error:</span> {errorMessage}
            </div>
          </div>
        )}

        {successData ? (
          <div className="space-y-4 text-sm">
            <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2 font-semibold text-emerald-900 text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Organisation successfully created</span>
              </div>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex justify-between py-1 border-b border-emerald-100">
                  <span className="text-slate-500">Organisation:</span>
                  <strong className="text-slate-900">{successData.organization.name}</strong>
                </div>
                <div className="flex justify-between py-1 border-b border-emerald-100">
                  <span className="text-slate-500">Slug:</span>
                  <code className="text-slate-800 font-mono">/{successData.organization.slug}</code>
                </div>
                <div className="flex justify-between py-1 border-b border-emerald-100">
                  <span className="text-slate-500">Administrator:</span>
                  <strong className="text-slate-900">{successData.owner.email}</strong>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Rate limit:</span>
                  <strong className="text-slate-900">
                    {successData.organization.maxRequestsPerSecond} requests/sec
                  </strong>
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Temporary password (copy and store securely)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={successData.temporaryPassword}
                    className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs text-slate-900"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleCopyPassword}
                    icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" variant="primary" onClick={handleResetAndClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Organisation name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Health Technologies"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Administrator name *
                </label>
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Administrator email *
                </label>
                <input
                  type="email"
                  required
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="admin@acme.org"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Outbound rate limit ceiling (requests/sec)
                </label>
                <span className="text-[11px] text-slate-500">
                  ~{Math.round(maxRequestsPerSecond * 60)} req/min
                </span>
              </div>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="100"
                required
                value={maxRequestsPerSecond}
                onChange={(e) => setMaxRequestsPerSecond(parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Enforced atomically across all campaigns and background worker nodes.
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
              <Button type="button" variant="secondary" onClick={handleResetAndClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={loading}>
                Provision organisation
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
