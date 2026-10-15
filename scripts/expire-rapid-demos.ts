/**
 * Mark every active rapid demo expired and clear its phone binding.
 * The shell wrapper sets DATABASE_URL and prints the target host.
 *   npm run demos:expire
 *   npm run demos:expire:staging
 */
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run npm run demos:expire.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  const active = await prisma.rapidDemo.findMany({
    where: { status: "active" },
    select: { id: true, code: true, websiteHost: true },
    orderBy: { createdAt: "asc" },
  });
  if (active.length === 0) {
    console.log("No active demos.");
    return;
  }
  await prisma.rapidDemo.updateMany({
    where: { id: { in: active.map((row) => row.id) } },
    data: { status: "expired", boundPhone: null },
  });
  console.log(`Expired ${active.length} demo${active.length === 1 ? "" : "s"}:`);
  for (const row of active) {
    console.log(`  ${row.code}  ${row.websiteHost || "(no site)"}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
