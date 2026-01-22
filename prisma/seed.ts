import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed data is for testing only - skip if we have real data
  const count = await prisma.station.count();
  if (count > 0) {
    console.log("⏭️ Stations already exist, skipping seed");
    return;
  }

  // This is legacy Phoenix light rail test data, not used for Chicago CTA
  console.log("⚠️ Seed file contains Phoenix test data - use Chicago seeder instead");
}


main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });