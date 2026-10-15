"use client";

import React, { useState, useRef } from "react";
import { X, UploadCloud, Download, CheckCircle, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";
import { CohortUploadSummary } from "@/types";

interface UploadCohortModalProps {
  isOpen: boolean;
  campaignId: string;
  campaignName: string;
  requiredVariables?: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadCohortModal({
  isOpen,
  campaignId,
  campaignName,
  requiredVariables = [],
  onClose,
  onSuccess,
}: UploadCohortModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<CohortUploadSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setErrorMessage(null);
      setSummary(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMessage("Please select a CSV file to upload.");
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/contacts/upload`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || "Failed to upload cohort");
      }

      setSummary(result.data);
      if (result.data.acceptedRows > 0) {
        onSuccess();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Upload Customer Cohort
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Campaign: <span className="font-medium text-zinc-800 dark:text-zinc-200">{campaignName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Required Variables & Sample Download Banner */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-blue-900 dark:text-blue-200">
          <div>
            <p className="font-semibold">Required columns: phone_number</p>
            {requiredVariables.length > 0 && (
              <p className="text-blue-700 dark:text-blue-300 mt-0.5">
                Agent variables: {requiredVariables.join(", ")}
              </p>
            )}
          </div>
          <a
            href={`/api/campaigns/${campaignId}/contacts/sample`}
            download
            className="inline-flex items-center px-3 py-1.5 rounded-md bg-white dark:bg-zinc-800 text-blue-700 dark:text-blue-300 font-medium border border-blue-300 dark:border-blue-800 hover:bg-blue-100 transition-colors shadow-2xs shrink-0"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Download Sample CSV
          </a>
        </div>

        {errorMessage && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Upload form */}
        {!summary ? (
          <form onSubmit={handleUpload} className="mt-4 space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition-colors"
            >
              <UploadCloud className="w-10 h-10 text-zinc-400 mx-auto" />
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {file ? file.name : "Click to select a CSV file"}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                CSV up to 5MB, with phone_number, optional lead_id, and prompt variables
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="pt-2 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={uploading}
                className="px-4 py-2 text-sm font-medium rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!file || uploading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {uploading ? "Parsing & Importing..." : "Upload & Validate"}
              </button>
            </div>
          </form>
        ) : (
          /* Upload Summary */
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 text-center">
                <p className="text-xs text-zinc-500">Processed</p>
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {summary.totalRowsProcessed}
                </p>
              </div>

              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg border border-emerald-200 dark:border-emerald-800 text-center">
                <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Accepted
                </p>
                <p className="text-xl font-bold text-emerald-800 dark:text-emerald-200">
                  {summary.acceptedRows}
                </p>
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800 text-center">
                <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center justify-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Duplicates
                </p>
                <p className="text-xl font-bold text-amber-800 dark:text-amber-200">
                  {summary.duplicatesSkipped}
                </p>
              </div>

              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-800 text-center">
                <p className="text-xs text-rose-700 dark:text-rose-300 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Rejected
                </p>
                <p className="text-xl font-bold text-rose-800 dark:text-rose-200">
                  {summary.rejectedRows}
                </p>
              </div>
            </div>

            {summary.errors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                  Validation & Duplication Notices ({summary.errors.length})
                </h4>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
                  {summary.errors.map((err, i) => (
                    <div key={i} className="p-2.5 text-xs flex items-start gap-2 bg-white dark:bg-zinc-900">
                      <span className="font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                        Row {err.row}
                      </span>
                      <div>
                        <p className="font-medium text-rose-600 dark:text-rose-400">{err.error}</p>
                        {err.details && <p className="text-zinc-500 mt-0.5">{err.details}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

