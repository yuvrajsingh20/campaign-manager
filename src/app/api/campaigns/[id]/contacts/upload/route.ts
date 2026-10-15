import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/validations/campaign";
import { ApiResponse, CohortUploadSummary } from "@/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 10000;
const BATCH_SIZE = 250;

/**
 * Normalizes column header names for flexible matching.
 */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s\-_]/g, "");
}

/**
 * POST /api/campaigns/[id]/contacts/upload
 * Processes multipart/form-data CSV cohort file upload with validation and deduplication.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    // Verify campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        workspace: true,
      },
    });

    if (!campaign) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${campaignId}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    // Check content-type
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "INVALID_CONTENT_TYPE",
            message: "Request must be multipart/form-data containing a CSV file.",
          },
        },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "MISSING_FILE",
            message: "No CSV file provided under 'file' form field.",
          },
        },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "EMPTY_FILE",
            message: "The uploaded CSV file is empty.",
          },
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: `File size exceeds the 5MB limit (${Math.round(file.size / 1024 / 1024)}MB).`,
          },
        },
        { status: 400 }
      );
    }

    const fileContent = await file.text();
    if (!fileContent.trim()) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "EMPTY_FILE",
            message: "The uploaded CSV file contains no content.",
          },
        },
        { status: 400 }
      );
    }

    // Parse CSV with PapaParse
    const parsed = Papa.parse<Record<string, string>>(fileContent, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors && parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "MALFORMED_CSV",
            message: "Failed to parse CSV file: " + parsed.errors[0]?.message,
            details: parsed.errors,
          },
        },
        { status: 400 }
      );
    }

    const rows = parsed.data;
    if (rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NO_DATA",
            message: "CSV contains headers but no data rows.",
          },
        },
        { status: 400 }
      );
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "ROW_LIMIT_EXCEEDED",
            message: `CSV row count (${rows.length}) exceeds the maximum allowed limit of ${MAX_ROWS} rows.`,
          },
        },
        { status: 400 }
      );
    }

    // Inspect headers
    const rawHeaders = parsed.meta.fields || Object.keys(rows[0] || {});
    const headerMap = new Map<string, string>(); // normalized -> raw
    for (const h of rawHeaders) {
      headerMap.set(normalizeHeader(h), h);
    }

    // Locate phone number column
    const phoneHeaderCandidates = [
      "phonenumber",
      "phone",
      "mobilenumber",
      "mobile",
      "contactnumber",
      "contact",
      "destinationphone",
      "telephone",
    ];

    let phoneColumnKey: string | null = null;
    for (const candidate of phoneHeaderCandidates) {
      if (headerMap.has(candidate)) {
        phoneColumnKey = headerMap.get(candidate)!;
        break;
      }
    }

    if (!phoneColumnKey) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "MISSING_PHONE_COLUMN",
            message:
              "Missing required phone number column. CSV must include a column named 'phone_number', 'phone', or 'mobile'.",
            details: { foundHeaders: rawHeaders },
          },
        },
        { status: 400 }
      );
    }

    // Locate optional lead_id, first_name, last_name
    const leadIdKey =
      headerMap.get("leadid") || headerMap.get("id") || headerMap.get("lead_id");
    const firstNameKey =
      headerMap.get("firstname") ||
      headerMap.get("first") ||
      headerMap.get("name");
    const lastNameKey =
      headerMap.get("lastname") || headerMap.get("last") || headerMap.get("surname");

    const requiredVars = campaign.requiredVariables || [];
    const missingCampaignVars = requiredVars.filter(
      (v) => !headerMap.has(normalizeHeader(v))
    );

    if (missingCampaignVars.length > 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "MISSING_REQUIRED_VARIABLES",
            message: `CSV is missing required agent variable column(s): ${missingCampaignVars.join(", ")}`,
            details: { missingVariables: missingCampaignVars },
          },
        },
        { status: 400 }
      );
    }

    // Fetch existing phone numbers and lead IDs in this campaign to detect duplicates
    const existingContacts = await prisma.contact.findMany({
      where: { campaignId },
      select: { phoneNumber: true, leadId: true },
    });

    const existingPhones = new Set(existingContacts.map((c) => c.phoneNumber));
    const existingLeadIds = new Set(
      existingContacts.filter((c) => c.leadId).map((c) => c.leadId!)
    );

    const summary: CohortUploadSummary = {
      totalRowsProcessed: rows.length,
      acceptedRows: 0,
      rejectedRows: 0,
      duplicatesSkipped: 0,
      errors: [],
    };

    const contactsToInsert: Array<{
      leadId: string;
      phoneNumber: string;
      firstName: string | null;
      lastName: string | null;
      customVariables: Prisma.InputJsonValue;
      workspaceId: string;
      campaignId: string;
    }> = [];

    const seenInFilePhones = new Set<string>();
    const seenInFileLeadIds = new Set<string>();

    // Process and validate rows
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 2; // +1 for 0-index, +1 for header line

      const rawPhone = row[phoneColumnKey];
      const normalizedPhone = normalizePhoneNumber(rawPhone || "");

      if (!normalizedPhone) {
        summary.rejectedRows++;
        summary.errors.push({
          row: rowNumber,
          error: `Invalid or missing phone number: '${rawPhone || ""}'`,
          details: "Phone number must be a valid international number (e.g. +919876543210)",
        });
        continue;
      }

      // Check duplicates within database or earlier in file
      if (existingPhones.has(normalizedPhone) || seenInFilePhones.has(normalizedPhone)) {
        summary.duplicatesSkipped++;
        summary.errors.push({
          row: rowNumber,
          error: `Duplicate phone number: '${normalizedPhone}'`,
          details: "Contact already exists in this campaign or was duplicated in the file",
        });
        continue;
      }

      // Extract or generate lead ID
      const rawLeadId = leadIdKey ? row[leadIdKey]?.trim() : null;
      const leadId =
        rawLeadId && rawLeadId.length > 0
          ? rawLeadId
          : `lead_${campaignId.slice(-6)}_${Date.now()}_${index}`;

      if (existingLeadIds.has(leadId) || seenInFileLeadIds.has(leadId)) {
        summary.duplicatesSkipped++;
        summary.errors.push({
          row: rowNumber,
          error: `Duplicate lead ID: '${leadId}'`,
          details: "A contact with this lead ID already exists in this campaign",
        });
        continue;
      }

      // Validate required agent variables for this row
      let hasMissingVar = false;
      for (const requiredVar of requiredVars) {
        const rawKey = headerMap.get(normalizeHeader(requiredVar));
        const val = rawKey ? row[rawKey]?.trim() : "";
        if (!val) {
          summary.rejectedRows++;
          summary.errors.push({
            row: rowNumber,
            error: `Missing required variable value for '${requiredVar}'`,
          });
          hasMissingVar = true;
          break;
        }
      }

      if (hasMissingVar) {
        continue;
      }

      // Extract custom variables (any column other than phone, leadId, firstName, lastName)
      const customVars: Record<string, unknown> = {};
      for (const [colName, colVal] of Object.entries(row)) {
        if (
          colName !== phoneColumnKey &&
          colName !== leadIdKey &&
          colName !== firstNameKey &&
          colName !== lastNameKey
        ) {
          if (colVal !== undefined && colVal !== null && colVal !== "") {
            customVars[colName] = colVal.trim();
          }
        }
      }

      const firstName = firstNameKey ? row[firstNameKey]?.trim() || null : null;
      const lastName = lastNameKey ? row[lastNameKey]?.trim() || null : null;

      seenInFilePhones.add(normalizedPhone);
      seenInFileLeadIds.add(leadId);

      contactsToInsert.push({
        leadId,
        phoneNumber: normalizedPhone,
        firstName,
        lastName,
        customVariables: customVars as Prisma.InputJsonObject,
        workspaceId: campaign.workspaceId,
        campaignId,
      });

      summary.acceptedRows++;
    }

    // Persist accepted contacts in batches
    if (contactsToInsert.length > 0) {
      for (let i = 0; i < contactsToInsert.length; i += BATCH_SIZE) {
        const batch = contactsToInsert.slice(i, i + BATCH_SIZE);
        await prisma.contact.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }
    }

    return NextResponse.json<ApiResponse<CohortUploadSummary>>({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("POST /api/campaigns/[id]/contacts/upload error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to process cohort upload",
        },
      },
      { status: 500 }
    );
  }
}
