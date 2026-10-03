import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testStationQuery() {
  try {
    console.log('Testing Prisma query for problematic station...');

    const stationId = 'df19d99efac023bfd0e7e87106692777';

    // Test basic query first
    const basicStation = await prisma.station.findUnique({
      where: { id: stationId }
    });

    console.log('Basic query successful:', {
      id: basicStation?.id,
      name: basicStation?.name,
      lines: basicStation?.lines
    });

    // Test with includes
    const stationWithIncludes = await prisma.station.findUnique({
      where: { id: stationId },
      include: {
        metrics: true,
        city: true
      }
    });

    console.log('Query with includes successful:', {
      station: stationWithIncludes?.name,
      metrics: stationWithIncludes?.metrics,
      city: stationWithIncludes?.city?.name
    });

  } catch (error) {
    console.error('Prisma query error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testStationQuery();