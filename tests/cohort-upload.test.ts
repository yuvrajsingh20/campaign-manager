import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { randomUUID } from "node:crypto";
import { POST as uploadCohort } from "../src/app/api/campaigns/[id]/contacts/upload/route";
import { GET as downloadSample } from "../src/app/api/campaigns/[id]/contacts/sample/route";

describe("CSV Cohort Upload and Sample Download", () => {
  let campaignId: string;
  let sessionCookie: string;
  let testSessionToken: string;

  before(async () => {
    let org = await prisma.organization.findUnique({
      where: { slug: "acme-corp" },
      include: {
        workspaces: { where: { slug: "default" } },
        users: { where: { email: "admin@acme.com" } },
      },
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: "Acme Corporation",
          slug: "acme-corp",
          workspaces: {
            create: { name: "Default Workspace", slug: "default" },
          },
          users: {
            create: {
              email: "admin@acme.com",
              name: "Admin User",
              role: "OWNER",
            },
          },
        },
        include: {
          workspaces: true,
          users: true,
        },
      });
    }

    let ws = org.workspaces[0];
    if (!ws) {
      ws = await prisma.workspace.create({
        data: { name: "Default Workspace", slug: "default", organizationId: org.id },
      });
    }

    let user = org.users[0];
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "admin@acme.com",
          name: "Admin User",
          role: "OWNER",
          organizationId: org.id,
        },
      });
    }

    testSessionToken = `test-cohort-${randomUUID()}`;
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: testSessionToken,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    sessionCookie = `session_token=${session.sessionToken}`;

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
    try {
      if (campaignId) {
        await prisma.contact.deleteMany({ where: { campaignId } });
        await prisma.callAttempt.deleteMany({ where: { campaignId } });
        await prisma.campaign.deleteMany({ where: { id: campaignId } });
      }
      if (testSessionToken) {
        await prisma.session.deleteMany({ where: { sessionToken: testSessionToken } });
      }
    } finally {
      await Promise.race([prisma.$disconnect(), new Promise((r) => setTimeout(r, 1000))]);
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
        Cookie: sessionCookie,
      },
      body: Buffer.from(bodyString),
    });
  }

  test("POST upload: CSV with valid and invalid rows processes properly", async () => {
    const csvContent =
      `lead_id,phone_number,first_name,last_name,account_type,due_date\n` +
      `L001,+919876543210,Aarav,Sharma,Savings,2026-11-01\n` +
      `L002,not-a-phone,Priya,Verma,Checking,2026-11-02\n` + // Invalid phone
      `L003,+919876543211,Rohan,Gupta,Business\n` + // Missing due_date (required variable)
      `L004,+919876543212,Ananya,Patel,Premium,2026-11-04\n`;

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
    assert.equal(body.data.acceptedRows, 2);
    assert.equal(body.data.rejectedRows, 2);
    assert.equal(body.data.duplicatesSkipped, 0);
    assert.equal(body.data.errors.length, 2);

    // Verify durable DB records
    const insertedContacts = await prisma.contact.findMany({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
    });

    assert.equal(insertedContacts.length, 2);
    assert.equal(insertedContacts[0].leadId, "L001");
    assert.equal(insertedContacts[0].status, "PENDING");
    assert.deepEqual(insertedContacts[0].customVariables, {
      account_type: "Savings",
      due_date: "2026-11-01",
    });
  });

  test("POST upload: Duplicate contacts in file and database are skipped", async () => {
    const csvContent =
      `lead_id,phone_number,first_name,last_name,account_type,due_date\n` +
      `L005,+919876543210,DuplicatePhone,User,Premium,2026-11-01\n` + // Already exists in DB (+919876543210 from L001)
      `L006,+919876543299,FreshUser,New,Basic,2026-11-05\n` +
      `L007,+919876543299,InFileDuplicate,Copy,Basic,2026-11-06\n`; // Duplicate phone in same file

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
    assert.equal(body.data.totalRowsProcessed, 3);
    assert.equal(body.data.acceptedRows, 1); // Only L006
    assert.equal(body.data.duplicatesSkipped, 2); // L005 (DB dupe) + L007 (in-file dupe)
  });

  test("POST upload: Missing phone number column returns 400", async () => {
    const csvContent =
      `lead_id,first_name,last_name,account_type,due_date\n` +
      `L008,NoPhone,User,Standard,2026-11-10\n`;

    const req = createMultipartRequest(
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/upload`,
      csvContent
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
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/sample`,
      {
        headers: { Cookie: sessionCookie },
      }
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
