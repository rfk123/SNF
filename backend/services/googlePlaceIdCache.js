import { prisma } from "../prisma/client.js";

async function readCacheRecord(key) {
  if (!key) return null;
  const record = await prisma.googlePlaceCache.findUnique({ where: { key } });
  if (!record) return null;
  return {
    place_id: record.place_id || null,
    name: record.name || null,
    formatted_address: record.formatted_address || null,
    location: record.location || null,
    resolved_at: record.resolved_at?.getTime() || null,
  };
}

async function writeCacheRecord(key, payload) {
  if (!key) return;
  await prisma.googlePlaceCache.upsert({
    where: { key },
    update: {
      place_id: payload.place_id || null,
      name: payload.name || null,
      formatted_address: payload.formatted_address || null,
      location: payload.location || null,
      resolved_at: payload.resolved_at ? new Date(payload.resolved_at) : new Date(),
    },
    create: {
      key,
      place_id: payload.place_id || null,
      name: payload.name || null,
      formatted_address: payload.formatted_address || null,
      location: payload.location || null,
      resolved_at: payload.resolved_at ? new Date(payload.resolved_at) : new Date(),
    },
  });
}

async function readAll() {
  const records = await prisma.googlePlaceCache.findMany();
  return records.reduce((acc, record) => {
    acc[record.key] = {
      place_id: record.place_id || null,
      name: record.name || null,
      formatted_address: record.formatted_address || null,
      location: record.location || null,
      resolved_at: record.resolved_at?.getTime() || null,
    };
    return acc;
  }, {});
}

export function createPlaceIdCache() {
  let cache = null;

  return {
    async get(key) {
      if (!key) return null;
      if (cache?.[key]) return cache[key];
      const record = await readCacheRecord(key);
      if (record) {
        cache = cache || {};
        cache[key] = record;
      }
      return record;
    },
    async set(key, payload) {
      if (!key) return;
      cache = cache || {};
      cache[key] = payload;
      await writeCacheRecord(key, payload);
    },
    async all() {
      if (!cache) {
        cache = await readAll();
      }
      return cache;
    },
  };
}
