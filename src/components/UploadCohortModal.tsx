"use client";

import React, { useState, useRef } from "react";
import {
  UploadCloud,
  Download,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import { CohortUploadSummary } from "@/types";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

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

  const handleResetAndClose = () => {
    setFile(null);
    setErrorMessage(null);
    setSummary(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleResetAndClose}
      title="Upload contact cohort"
      description={`Add audience records to campaign "${campaignName}"`}
      maxWidth="2xl"
    >
      <div className="space-y-5">
        {/* Required Variables & Template Banner */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <span>Required header:</span>
              <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded font-mono">
                phone_number
              </code>
            </div>
            {requiredVariables.length > 0 ? (
              <p className="text-slate-500">
                Agent dynamic variables:{" "}
                <strong className="text-slate-700">
                  {requiredVariables.join(", ")}
                </strong>
              </p>
            ) : (
              <p className="text-slate-500">
                Optional columns: lead_id, first_name, last_name
              </p>
            )}
          </div>
          <a
            href={`/api/campaigns/${campaignId}/contacts/sample`}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-medium border border-slate-300 rounded-lg shadow-2xs transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Download template CSV
          </a>
        </div>

        {errorMessage && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <span className="font-semibold">Upload error:</span> {errorMessage}
            </div>
          </div>
        )}

        {/* Upload form */}
        {!summary ? (
          <form onSubmit={handleUpload} className="space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                file
                  ? "border-blue-400 bg-blue-50/20"
                  : "border-slate-300 hover:border-blue-400 hover:bg-slate-50/60"
              }`}
            >
              {file ? (
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mx-auto">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {(file.size / 1024).toFixed(1)} KB • Click to choose a different file
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                    <UploadCloud className="w-6 h-6 text-slate-600" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">
                    Click to browse or drop CSV file
                  </p>
                  <p className="text-xs text-slate-500">
                    Maximum recommended batch size: 10,000 rows
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleResetAndClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!file}
                isLoading={uploading}
                icon={<UploadCloud className="w-4 h-4" />}
              >
                Upload and validate contacts
              </Button>
            </div>
          </form>
        ) : (
          /* Summary view */
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Upload complete</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center shadow-2xs">
                  <span className="text-slate-500 block text-[11px]">Processed</span>
                  <strong className="text-base font-semibold text-slate-900">
                    {summary.totalRowsProcessed}
                  </strong>
                </div>
                <div className="bg-white border border-emerald-200 rounded-lg p-2.5 text-center shadow-2xs">
                  <span className="text-emerald-700 block text-[11px]">Accepted</span>
                  <strong className="text-base font-semibold text-emerald-700">
                    {summary.acceptedRows}
                  </strong>
                </div>
                <div className="bg-white border border-amber-200 rounded-lg p-2.5 text-center shadow-2xs">
                  <span className="text-amber-700 block text-[11px]">Duplicates</span>
                  <strong className="text-base font-semibold text-amber-700">
                    {summary.duplicatesSkipped}
                  </strong>
                </div>
                <div className="bg-white border border-rose-200 rounded-lg p-2.5 text-center shadow-2xs">
                  <span className="text-rose-700 block text-[11px]">Rejected</span>
                  <strong className="text-base font-semibold text-rose-700">
                    {summary.rejectedRows}
                  </strong>
                </div>
              </div>
            </div>

            {/* Error Breakdown if any */}
            {summary.errors && summary.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-rose-800 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>Validation issues ({summary.errors.length} rows)</span>
                </div>
                <div className="max-h-40 overflow-y-auto border border-rose-200 bg-rose-50/50 rounded-lg divide-y divide-rose-100 text-xs">
                  {summary.errors.map((err, i) => (
                    <div key={i} className="p-2 flex items-start gap-2">
                      <span className="font-semibold text-rose-900 shrink-0">
                        Row {err.row}:
                      </span>
                      <span className="text-rose-800">
                        {err.error}
                        {err.details ? ` (${err.details})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="primary"
                onClick={handleResetAndClose}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
