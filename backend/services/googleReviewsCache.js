import { prisma } from "../prisma/client.js";

async function readSnapshot(placeId) {
  if (!placeId) return null;
  const record = await prisma.googleReviewsSnapshot.findUnique({ where: { place_id: placeId } });
  if (!record) return null;
  return {
    ...record.snapshot,
    fetched_at: record.fetched_at?.getTime() ?? null,
  };
}

async function writeSnapshot(placeId, payload) {
  if (!placeId) return;
  await prisma.googleReviewsSnapshot.upsert({
    where: { place_id: placeId },
    update: {
      snapshot: payload,
      fetched_at: payload?.fetched_at ? new Date(payload.fetched_at) : new Date(),
    },
    create: {
      place_id: placeId,
      snapshot: payload,
      fetched_at: payload?.fetched_at ? new Date(payload.fetched_at) : new Date(),
    },
  });
}

async function readAll() {
  const records = await prisma.googleReviewsSnapshot.findMany();
  return records.reduce((acc, record) => {
    acc[record.place_id] = {
      ...record.snapshot,
      fetched_at: record.fetched_at?.getTime() ?? null,
    };
    return acc;
  }, {});
}

export function createReviewCache() {
  let cache = null;

  return {
    async get(placeId) {
      if (!placeId) return null;
      if (cache?.[placeId]) return cache[placeId];
      const record = await readSnapshot(placeId);
      if (record) {
        cache = cache || {};
        cache[placeId] = record;
      }
      return record;
    },
    async set(placeId, payload) {
      if (!placeId) return;
      cache = cache || {};
      cache[placeId] = payload;
      await writeSnapshot(placeId, payload);
    },
    async dump() {
      if (!cache) {
        cache = await readAll();
      }
      return cache;
    },
  };
}
