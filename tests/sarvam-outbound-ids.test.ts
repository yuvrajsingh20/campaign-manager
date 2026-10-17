import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { OrganizationStatus } from "@prisma/client";
import { OrgRateLimiter } from "../src/lib/rate-limiter";
import { processOutboundCallJob } from "../src/lib/execution-engine";
import {
  SarvamClient,
  SarvamApiError,
  resolveSarvamOutboundPathIds,
  type SarvamOutboundPayload,
} from "../src/lib/sarvam";

const SAMPLE_PAYLOAD: SarvamOutboundPayload = {
  app_config: {
    app_id: "agent_live_101",
    app_version: 1,
    app_type: "agent",
    connection_config: {
      connection_id: "conn_trunk_01",
      agent_phone_number: "+14155552671",
    },
    agent_variables: {},
    app_overrides: null,
  },
  user_config: {
    user_phone_number: "+919876543210",
  },
};

describe("Sarvam outbound path IDs vs internal tenant IDs", () => {
  let org: { id: string };
  let workspace: { id: string };
  const uniqueSuffix = Date.now().toString().slice(-6);

  const originalEnv = {
    SARVAM_ORG_ID: process.env.SARVAM_ORG_ID,
    SARVAM_WORKSPACE_ID: process.env.SARVAM_WORKSPACE_ID,
    SARVAM_API_KEY: process.env.SARVAM_API_KEY,
    SARVAM_MOCK_MODE: process.env.SARVAM_MOCK_MODE,
    SARVAM_API_BASE_URL: process.env.SARVAM_API_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };

  before(async () => {
    org = await prisma.organization.create({
      data: {
        name: `Sarvam Path Org ${uniqueSuffix}`,
        slug: `sarvam-path-org-${uniqueSuffix}`,
        status: OrganizationStatus.ACTIVE,
        maxRequestsPerSecond: 10,
      },
    });
    workspace = await prisma.workspace.create({
      data: {
        name: "Path Workspace",
        slug: "path-ws",
        organizationId: org.id,
      },
    });
  });

  after(async () => {
    await prisma.callAttempt.deleteMany({
      where: { campaign: { organizationId: org.id } },
    });
    await prisma.contact.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.campaign.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { id: workspace.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await redis.del(`ratelimit:org:${org.id}`);

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      await Promise.race([redis.quit(), new Promise((r) => setTimeout(r, 1000))]);
    } catch {
      redis.disconnect();
    }
    await Promise.race([prisma.$disconnect(), new Promise((r) => setTimeout(r, 1000))]);
  });

  function restoreSarvamEnv() {
    for (const key of [
      "SARVAM_ORG_ID",
      "SARVAM_WORKSPACE_ID",
      "SARVAM_API_KEY",
      "SARVAM_MOCK_MODE",
      "SARVAM_API_BASE_URL",
    ] as const) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv.NODE_ENV;
  }

  test("1. resolveSarvamOutboundPathIds requires configured env vars in live mode", () => {
    delete process.env.SARVAM_ORG_ID;
    delete process.env.SARVAM_WORKSPACE_ID;

    assert.throws(
      () => resolveSarvamOutboundPathIds({ requireConfigured: true }),
      (err: unknown) =>
        err instanceof SarvamApiError && /SARVAM_ORG_ID must be configured/.test(err.message)
    );

    process.env.SARVAM_ORG_ID = "your-sarvam-org-id-here";
    process.env.SARVAM_WORKSPACE_ID = "ws_real_from_dashboard";
    assert.throws(
      () => resolveSarvamOutboundPathIds({ requireConfigured: true }),
      (err: unknown) =>
        err instanceof SarvamApiError && /SARVAM_ORG_ID must be configured/.test(err.message)
    );

    process.env.SARVAM_ORG_ID = "org_sarvam_external_abc";
    process.env.SARVAM_WORKSPACE_ID = "ws_sarvam_external_xyz";
    const resolved = resolveSarvamOutboundPathIds({ requireConfigured: true });
    assert.equal(resolved.orgId, "org_sarvam_external_abc");
    assert.equal(resolved.workspaceId, "ws_sarvam_external_xyz");

    restoreSarvamEnv();
  });

  test("2. Live outbound URL uses SARVAM_ORG_ID / SARVAM_WORKSPACE_ID, not Prisma CUIDs", async () => {
    const externalOrgId = "org_sarvam_external_abc";
    const externalWorkspaceId = "ws_sarvam_external_xyz";
    process.env.SARVAM_ORG_ID = externalOrgId;
    process.env.SARVAM_WORKSPACE_ID = externalWorkspaceId;
    process.env.SARVAM_API_BASE_URL = "https://apps.sarvam.ai";

    const client = new SarvamClient({
      apiKey: "live_test_api_key_not_a_placeholder",
      mockMode: false,
      baseUrl: "https://apps.sarvam.ai",
    });

    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ attempt_id: "att_test_no_real_call" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await client.createOutboundCall(
        externalOrgId,
        externalWorkspaceId,
        SAMPLE_PAYLOAD
      );
      assert.equal(result.attempt_id, "att_test_no_real_call");
      assert.match(
        capturedUrl,
        new RegExp(
          `/api/outbounds/v1/orgs/${externalOrgId}/workspaces/${externalWorkspaceId}/outbounds$`
        )
      );
      assert.doesNotMatch(capturedUrl, new RegExp(org.id));
      assert.doesNotMatch(capturedUrl, new RegExp(workspace.id));
    } finally {
      globalThis.fetch = originalFetch;
      restoreSarvamEnv();
    }
  });

  test("3. Live createOutboundCall rejects internal Prisma CUIDs even if passed explicitly", async () => {
    process.env.SARVAM_ORG_ID = "org_sarvam_external_abc";
    process.env.SARVAM_WORKSPACE_ID = "ws_sarvam_external_xyz";

    const client = new SarvamClient({
      apiKey: "live_test_api_key_not_a_placeholder",
      mockMode: false,
    });

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ attempt_id: "should_not_happen" }), {
        status: 200,
      });
    }) as typeof fetch;

    try {
      await assert.rejects(
        () => client.createOutboundCall(org.id, workspace.id, SAMPLE_PAYLOAD),
        (err: unknown) =>
          err instanceof SarvamApiError &&
          /must use SARVAM_ORG_ID and SARVAM_WORKSPACE_ID/.test(err.message)
      );
      assert.equal(fetchCalled, false, "Must not call the provider with internal CUIDs");
    } finally {
      globalThis.fetch = originalFetch;
      restoreSarvamEnv();
    }
  });

  test("4. Live dispatch fails fast when SARVAM_ORG_ID / SARVAM_WORKSPACE_ID are missing", async () => {
    const originalMock = process.env.SARVAM_MOCK_MODE;
    const originalKey = process.env.SARVAM_API_KEY;
    const originalOrg = process.env.SARVAM_ORG_ID;
    const originalWs = process.env.SARVAM_WORKSPACE_ID;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      process.env.SARVAM_MOCK_MODE = "false";
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      process.env.SARVAM_API_KEY = "live_test_api_key_12345";
      delete process.env.SARVAM_ORG_ID;
      delete process.env.SARVAM_WORKSPACE_ID;

      const campaign = await prisma.campaign.create({
        data: {
          name: "Missing Sarvam Path IDs",
          organizationId: org.id,
          workspaceId: workspace.id,
          status: "RUNNING",
          agentAppId: "agent_production_101",
          connectionId: "conn_trunk_01",
          callerPhoneNumber: "+14155552671",
          dailyStartTime: "00:00",
          dailyEndTime: "23:59",
          allowedDays: [
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ],
        },
      });

      const contact = await prisma.contact.create({
        data: {
          campaignId: campaign.id,
          workspaceId: workspace.id,
          phoneNumber: "+919876543288",
          status: "QUEUED",
        },
      });

      await assert.rejects(
        async () =>
          processOutboundCallJob({
            campaignId: campaign.id,
            contactId: contact.id,
            attemptNumber: 1,
          }),
        /SARVAM_ORG_ID must be configured/,
        "Must not silently fall back to Prisma CUIDs or mock path IDs in live mode"
      );

      await prisma.contact.deleteMany({ where: { id: contact.id } });
      await prisma.callAttempt.deleteMany({ where: { campaignId: campaign.id } });
      await prisma.campaign.deleteMany({ where: { id: campaign.id } });
    } finally {
      process.env.SARVAM_MOCK_MODE = originalMock;
      process.env.SARVAM_API_KEY = originalKey;
      if (originalOrg === undefined) delete process.env.SARVAM_ORG_ID;
      else process.env.SARVAM_ORG_ID = originalOrg;
      if (originalWs === undefined) delete process.env.SARVAM_WORKSPACE_ID;
      else process.env.SARVAM_WORKSPACE_ID = originalWs;
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    }
  });

  test("5. Internal organisation IDs still isolate rate limits when Sarvam path IDs are shared", async () => {
    // Shared Sarvam account IDs must not collapse tenant rate-limit keys
    const sharedSarvamOrg = "org_shared_sarvam_account";
    process.env.SARVAM_ORG_ID = sharedSarvamOrg;
    process.env.SARVAM_WORKSPACE_ID = "ws_shared_sarvam_account";

    const orgB = await prisma.organization.create({
      data: {
        name: `Sarvam Path Org B ${uniqueSuffix}`,
        slug: `sarvam-path-org-b-${uniqueSuffix}`,
        status: OrganizationStatus.ACTIVE,
        maxRequestsPerSecond: 3,
      },
    });

    try {
      await redis.del(`ratelimit:org:${org.id}`, `ratelimit:org:${orgB.id}`);
      await redis.del(`ratelimit:org:${sharedSarvamOrg}`);

      for (let i = 0; i < 3; i++) {
        const res = await OrgRateLimiter.acquire(org.id, 3, 3);
        assert.equal(res.allowed, true, `Org A token ${i + 1} should be allowed`);
      }
      const deniedA = await OrgRateLimiter.acquire(org.id, 3, 3);
      assert.equal(deniedA.allowed, false, "Org A must be rate-limited on its internal ID");

      const allowedB = await OrgRateLimiter.acquire(orgB.id, 3, 3);
      assert.equal(
        allowedB.allowed,
        true,
        "Org B must keep an independent counter keyed by its Prisma organisation ID"
      );

      // Shared Sarvam path ID must not be used as the Redis rate-limit key
      const sharedKeyExists = await redis.exists(`ratelimit:org:${sharedSarvamOrg}`);
      assert.equal(
        sharedKeyExists,
        0,
        "Rate limiter must not key off SARVAM_ORG_ID"
      );
    } finally {
      await redis.del(`ratelimit:org:${org.id}`, `ratelimit:org:${orgB.id}`);
      await prisma.organization.deleteMany({ where: { id: orgB.id } });
      restoreSarvamEnv();
    }
  });
});
