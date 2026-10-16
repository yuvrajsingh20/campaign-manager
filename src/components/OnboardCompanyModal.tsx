"use client";

import React, { useState } from "react";
import { X, Building2, User, Mail, Zap, Loader2, CheckCircle2, Copy, AlertCircle } from "lucide-react";

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

export function OnboardCompanyModal({ isOpen, onClose, onSuccess }: OnboardCompanyModalProps) {
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
        setErrorMessage(data?.error?.message || "Failed to onboard company.");
        return;
      }

      setSuccessData(data.data);
      onSuccess();
    } catch (err) {
      console.error("Onboard error:", err);
      setErrorMessage("Network error occurred while onboarding company.");
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full p-6 border border-zinc-200 dark:border-zinc-800 shadow-xl space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-600 rounded-lg">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Onboard Company</h3>
              <p className="text-xs text-zinc-500">Create new tenant organization and default workspace</p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs rounded-xl flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successData ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-3">
              <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Company Successfully Onboarded!</span>
              </div>
              <div className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <p>
                  <strong className="text-zinc-900 dark:text-zinc-100">Company:</strong>{" "}
                  {successData.organization.name}
                </p>
                <p>
                  <strong className="text-zinc-900 dark:text-zinc-100">Owner Email:</strong>{" "}
                  {successData.owner.email}
                </p>
                <p>
                  <strong className="text-zinc-900 dark:text-zinc-100">RPS Limit:</strong>{" "}
                  {successData.organization.maxRequestsPerSecond} req/sec
                </p>
              </div>
              <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/60">
                <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Temporary Owner Password (Save for login):
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={successData.temporaryPassword}
                    className="w-full font-mono text-xs px-3 py-2 bg-white dark:bg-zinc-800 rounded-lg border border-emerald-300 dark:border-emerald-700 text-zinc-900 dark:text-zinc-100 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1 cursor-pointer shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copied ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetAndClose}
              className="w-full py-2.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            >
              Done & Return to Dashboard
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                Company Name
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Health Systems"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Owner Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Elena Rostova"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Initial RPS Limit
                </label>
                <div className="relative">
                  <Zap className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="100"
                    required
                    value={maxRequestsPerSecond}
                    onChange={(e) => setMaxRequestsPerSecond(parseFloat(e.target.value))}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                Owner Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                <input
                  type="email"
                  required
                  placeholder="elena@apexhealth.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">
                A secure account will be generated for this owner to access their isolated company campaigns.
              </p>
            </div>

            <div className="pt-3 flex justify-end space-x-3">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs flex items-center cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Onboarding...
                  </>
                ) : (
                  "Onboard Company"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

