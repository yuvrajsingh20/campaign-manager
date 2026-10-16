import { PrismaClient, Role, OrganizationStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const prisma = new PrismaClient();

async function main() {
  console.log("-----------------------------------------------------------------");
  console.log("🌱 CAMPAIGN MANAGER - DETERMINISTIC DEMO DATA SEED");
  console.log("-----------------------------------------------------------------");

  // Safety Guard: Never run development demo seeds in production without explicit flag
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    console.error(
      "❌ SEED ABORTED: Cannot seed demo accounts in production environment without explicit ALLOW_PRODUCTION_SEED=true"
    );
    process.exit(1);
  }

  // 1. Seed Superadmin Account
  const superadminEmail = (process.env.SUPERADMIN_EMAIL || "voiceagent@yopmail.com").toLowerCase().trim();
  const superadminPassword = process.env.SUPERADMIN_PASSWORD || "12345678";
  const superadminPasswordHash = hashPassword(superadminPassword);

  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {
      role: Role.SUPERADMIN,
      passwordHash: superadminPasswordHash,
      organizationId: null,
    },
    create: {
      email: superadminEmail,
      name: "VoiceAgent Superadmin",
      role: Role.SUPERADMIN,
      passwordHash: superadminPasswordHash,
      organizationId: null,
    },
  });
  console.log(`✔ Superadmin provisioned: ${superadmin.email} (Role: ${superadmin.role})`);

  // 2. Seed Organisation A (Acme Corporation) - 5.0 RPS limit
  const orgA = await prisma.organization.upsert({
    where: { slug: "acme-corp" },
    update: {
      name: "Acme Corporation",
      status: OrganizationStatus.ACTIVE,
      maxRequestsPerSecond: 5.0,
      rateLimitPerMinute: 300,
    },
    create: {
      name: "Acme Corporation",
      slug: "acme-corp",
      status: OrganizationStatus.ACTIVE,
      maxRequestsPerSecond: 5.0,
      rateLimitPerMinute: 300,
    },
  });

  // Workspace A1: Default Workspace
  const wsA1 = await prisma.workspace.upsert({
    where: {
      organizationId_slug: { organizationId: orgA.id, slug: "default" },
    },
    update: { name: "Default Workspace" },
    create: {
      name: "Default Workspace",
      slug: "default",
      organizationId: orgA.id,
    },
  });

  // Workspace A2: Collections & Renewals
  const wsA2 = await prisma.workspace.upsert({
    where: {
      organizationId_slug: { organizationId: orgA.id, slug: "renewals" },
    },
    update: { name: "Collections & Renewals" },
    create: {
      name: "Collections & Renewals",
      slug: "renewals",
      organizationId: orgA.id,
    },
  });

  // Owner A: Acme Owner
  const ownerAEmail = (process.env.COMPANY_OWNER_EMAIL || "admin@acme.com").toLowerCase().trim();
  const ownerAPassword = process.env.COMPANY_OWNER_PASSWORD || "12345678";
  const ownerAPasswordHash = hashPassword(ownerAPassword);

  const ownerA = await prisma.user.upsert({
    where: { email: ownerAEmail },
    update: {
      role: Role.OWNER,
      organizationId: orgA.id,
      passwordHash: ownerAPasswordHash,
    },
    create: {
      email: ownerAEmail,
      name: "Acme Owner",
      role: Role.OWNER,
      organizationId: orgA.id,
      passwordHash: ownerAPasswordHash,
    },
  });

  console.log(`✔ Org A provisioned: ${orgA.name} (${orgA.slug}) | Workspaces: [${wsA1.name}, ${wsA2.name}] | Owner: ${ownerA.email}`);

  // 3. Seed Organisation B (Beta Health Systems) - 8.0 RPS limit
  const orgB = await prisma.organization.upsert({
    where: { slug: "beta-health" },
    update: {
      name: "Beta Health Systems",
      status: OrganizationStatus.ACTIVE,
      maxRequestsPerSecond: 8.0,
      rateLimitPerMinute: 480,
    },
    create: {
      name: "Beta Health Systems",
      slug: "beta-health",
      status: OrganizationStatus.ACTIVE,
      maxRequestsPerSecond: 8.0,
      rateLimitPerMinute: 480,
    },
  });

  // Workspace B1: Default Workspace
  const wsB1 = await prisma.workspace.upsert({
    where: {
      organizationId_slug: { organizationId: orgB.id, slug: "default" },
    },
    update: { name: "Default Workspace" },
    create: {
      name: "Default Workspace",
      slug: "default",
      organizationId: orgB.id,
    },
  });

  // Workspace B2: Patient Reminders
  const wsB2 = await prisma.workspace.upsert({
    where: {
      organizationId_slug: { organizationId: orgB.id, slug: "reminders" },
    },
    update: { name: "Patient Reminders" },
    create: {
      name: "Patient Reminders",
      slug: "reminders",
      organizationId: orgB.id,
    },
  });

  // Owner B: Beta Health Owner
  const ownerBEmail = (process.env.ORG_B_OWNER_EMAIL || "admin@betahealth.com").toLowerCase().trim();
  const ownerBPassword = process.env.ORG_B_OWNER_PASSWORD || "12345678";
  const ownerBPasswordHash = hashPassword(ownerBPassword);

  const ownerB = await prisma.user.upsert({
    where: { email: ownerBEmail },
    update: {
      role: Role.OWNER,
      organizationId: orgB.id,
      passwordHash: ownerBPasswordHash,
    },
    create: {
      email: ownerBEmail,
      name: "Beta Health Owner",
      role: Role.OWNER,
      organizationId: orgB.id,
      passwordHash: ownerBPasswordHash,
    },
  });

  console.log(`✔ Org B provisioned: ${orgB.name} (${orgB.slug}) | Workspaces: [${wsB1.name}, ${wsB2.name}] | Owner: ${ownerB.email}`);

  console.log("-----------------------------------------------------------------");
  console.log("✨ Seed completed idempotently and successfully!");
  console.log("-----------------------------------------------------------------");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
