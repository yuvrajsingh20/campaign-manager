import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create default organization
  const organization = await prisma.organization.upsert({
    where: { slug: "acme-corp" },
    update: {},
    create: {
      name: "Acme Corporation",
      slug: "acme-corp",
      rateLimitPerMinute: 60,
    },
  });

  // Create default workspace
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

  // Create default user
  await prisma.user.upsert({
    where: { email: "admin@acme.com" },
    update: {},
    create: {
      email: "admin@acme.com",
      name: "Admin User",
      role: Role.OWNER,
      organizationId: organization.id,
    },
  });

  console.log("Seeded organization:", organization.name, `(${organization.id})`);
  console.log("Seeded workspace:", workspace.name, `(${workspace.id})`);
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

