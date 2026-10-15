import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { POST as uploadCohort } from "../src/app/api/campaigns/[id]/contacts/upload/route";
import { GET as downloadSample } from "../src/app/api/campaigns/[id]/contacts/sample/route";

describe("CSV Cohort Upload and Sample Download", () => {
  let campaignId: string;

  before(async () => {
    const org = await prisma.organization.upsert({
      where: { slug: "acme-corp" },
      update: {},
      create: { name: "Acme Corporation", slug: "acme-corp" },
    });

    const ws = await prisma.workspace.upsert({
      where: {
        organizationId_slug: { organizationId: org.id, slug: "default" },
      },
      update: {},
      create: { name: "Default Workspace", slug: "default", organizationId: org.id },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Cohort Ingestion Test Campaign",
        workspaceId: ws.id,
        organizationId: org.id,
        requiredVariables: ["account_type", "due_date"],
      },
    });

    campaignId = campaign.id;
  });

  after(async () => {
    if (campaignId) {
      await prisma.contact.deleteMany({ where: { campaignId } });
      await prisma.campaign.deleteMany({ where: { id: campaignId } });
    }
  });

  function createMultipartRequest(url: string, csvContent: string): NextRequest {
    const boundary = "----WebKitFormBoundaryTest123456789";
    const bodyString =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="contacts.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `${csvContent}\r\n` +
      `--${boundary}--\r\n`;

    return new NextRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.from(bodyString),
    });
  }

  test("POST upload: CSV with valid and invalid rows processes properly", async () => {
    const csvContent =
      `lead_id,phone_number,first_name,last_name,account_type,due_date\n` +
      `L001,+919876543210,Aarav,Patel,Premium,2026-11-01\n` +
      `L002,not-a-phone,Bob,Smith,Basic,2026-11-05\n` + // Invalid phone
      `L003,+14155552671,Carol,White,Enterprise,2026-11-10\n` +
      `L004,+919876543212,David,Kumar,,2026-11-12\n`; // Missing required variable account_type

    const req = createMultipartRequest(
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/upload`,
      csvContent
    );

    const res = await uploadCohort(req, {
      params: Promise.resolve({ id: campaignId }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.totalRowsProcessed, 4);
    assert.equal(body.data.acceptedRows, 2); // L001, L003
    assert.equal(body.data.rejectedRows, 2); // L002 (invalid phone), L004 (missing account_type)
    assert.ok(body.data.errors.length >= 2);

    // Verify row numbers in errors
    const errorRows = body.data.errors.map((e: { row: number }) => e.row);
    assert.ok(errorRows.includes(3), "Row 3 should be reported as invalid phone");
    assert.ok(errorRows.includes(5), "Row 5 should be reported as missing account_type");
  });

  test("POST upload: Duplicate contacts in file and database are skipped", async () => {
    const csvWithDuplicates =
      `lead_id,phone_number,first_name,last_name,account_type,due_date\n` +
      `L005,+919876543210,DuplicatePhone,User,Premium,2026-11-01\n` + // Already exists in DB (+919876543210 from L001)
      `L006,+919876543299,FreshUser,New,Basic,2026-11-05\n` +
      `L007,+919876543299,DuplicateInFile,New,Basic,2026-11-05\n`; // Duplicate in same file

    const req = createMultipartRequest(
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/upload`,
      csvWithDuplicates
    );

    const res = await uploadCohort(req, {
      params: Promise.resolve({ id: campaignId }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.acceptedRows, 1); // L006 accepted
    assert.equal(body.data.duplicatesSkipped, 2); // L005 (existing DB) and L007 (duplicate in file)
  });

  test("POST upload: Missing phone number column returns 400", async () => {
    const csvNoPhone =
      `lead_id,first_name,last_name,account_type,due_date\n` +
      `L010,John,Doe,Premium,2026-11-01\n`;

    const req = createMultipartRequest(
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/upload`,
      csvNoPhone
    );

    const res = await uploadCohort(req, {
      params: Promise.resolve({ id: campaignId }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "MISSING_PHONE_COLUMN");
  });

  test("POST upload: Nonexistent campaign returns 404", async () => {
    const csvContent =
      `phone_number,first_name\n` +
      `+919876543210,Test\n`;

    const req = createMultipartRequest(
      "http://localhost:3000/api/campaigns/nonexistent_id_404/contacts/upload",
      csvContent
    );

    const res = await uploadCohort(req, {
      params: Promise.resolve({ id: "nonexistent_id_404" }),
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NOT_FOUND");
  });

  test("GET sample: Downloads CSV template tailored to campaign required variables", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/sample`
    );

    const res = await downloadSample(req, {
      params: Promise.resolve({ id: campaignId }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type")?.includes("text/csv"));
    assert.ok(res.headers.get("Content-Disposition")?.includes("attachment"));

    const text = await res.text();
    const lines = text.trim().split("\r\n").join("\n").split("\n");
    const headerLine = lines[0];

    assert.ok(headerLine.includes("lead_id"));
    assert.ok(headerLine.includes("phone_number"));
    assert.ok(headerLine.includes("account_type"));
    assert.ok(headerLine.includes("due_date"));
    assert.ok(lines.length >= 2, "Should contain at least header and sample row");
  });
});
