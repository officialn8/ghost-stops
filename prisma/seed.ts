import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.station.createMany({
    data: [
      { id: "1", name: "Metro Pkwy", latitude: 33.57520649047962, longitude: -112.11850588386676 },
      { id: "2", name: "Mountain View/25th Ave", latitude: 33.57332976127176, longitude: -112.11211080579524 },
      { id: "3", name: "25th Ave/Dunlap", latitude: 33.56760630616105, longitude: -112.11144815412962 },
      { id: "4", name: "19th Ave/Dunlap", latitude: 33.56743723033454, longitude: -112.10085003262391 },
      { id: "5", name: "Northern/19th Ave", latitude: 33.552309920710705, longitude: -112.09962318145529 },
      { id: "6", name: "Glendale/19th Ave", latitude: 33.53752619818957, longitude: -112.09968803559084 },
      { id: "7", name: "Montebello/ 19th Ave", latitude: 33.52086803447301, longitude: -112.09973127397178 },
      { id: "8", name: "19th Ave/Camelback", latitude: 33.509880009826524, longitude: -112.0987260856489 },
      { id: "9", name: "7th Ave/Camelback", latitude: 33.509644916919484, longitude: -112.08341582711675 },
      { id: "10", name: "Central Ave/Camelback", latitude: 33.50889348097592, longitude: -112.07528336946422 },
      { id: "11", name: "Campbell/Central Ave", latitude: 33.50147009694075, longitude: -112.07384858465619 },
      { id: "12", name: "Indian School/Central Ave", latitude: 33.49604836495293, longitude: -112.0737627540092 },
    ],
  });

  console.log("✅ Seed data added!");
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });