import { PrismaClient, Role, OrganizationStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Seed Superadmin account idempotently from environment variables
  const superadminEmail = process.env.SUPERADMIN_EMAIL || "voiceagent@yopmail.com";
  const superadminPassword = process.env.SUPERADMIN_PASSWORD || "12345678";
  const superadminPasswordHash = hashPassword(superadminPassword);

  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {
      role: Role.SUPERADMIN,
      passwordHash: superadminPasswordHash,
    },
    create: {
      email: superadminEmail,
      name: "VoiceAgent Superadmin",
      role: Role.SUPERADMIN,
      passwordHash: superadminPasswordHash,
      organizationId: null,
    },
  });
  console.log("Seeded Superadmin user:", superadmin.email, `(Role: ${superadmin.role})`);

  // 2. Create default demo company (Acme Corporation)
  const organization = await prisma.organization.upsert({
    where: { slug: "acme-corp" },
    update: {
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

  // 3. Create default workspace for Acme Corp
  const workspace = await prisma.workspace.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "default",
      },
    },
    update: {},
    create: {
      name: "Default Workspace",
      slug: "default",
      organizationId: organization.id,
    },
  });

  // 4. Create default company owner user
  const companyOwnerEmail = process.env.COMPANY_OWNER_EMAIL || "admin@acme.com";
  const companyOwnerPassword = process.env.COMPANY_OWNER_PASSWORD || "12345678";
  const ownerPasswordHash = hashPassword(companyOwnerPassword);

  const owner = await prisma.user.upsert({
    where: { email: companyOwnerEmail },
    update: {
      role: Role.OWNER,
      organizationId: organization.id,
      passwordHash: ownerPasswordHash,
    },
    create: {
      email: companyOwnerEmail,
      name: "Acme Owner",
      role: Role.OWNER,
      organizationId: organization.id,
      passwordHash: ownerPasswordHash,
    },
  });

  console.log("Seeded organization:", organization.name, `(${organization.id})`);
  console.log("Seeded workspace:", workspace.name, `(${workspace.id})`);
  console.log("Seeded company owner:", owner.email, `(${owner.id})`);
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
