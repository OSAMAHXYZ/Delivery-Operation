import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.appSetting.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      rules: {
        autoAllocate: false,
        qualityThresholds: { compliant: 100, minor: 90, needsCorrection: 70 },
        allocationWeights: {
          payment: 30,
          aging: 25,
          fastProduct: 10,
          confirmation: 15,
          matchScore: 20,
        },
      },
    },
  });

  console.log("Seed complete — connect DATABASE_URL and run migrations first.");
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
