// backend/utils/strings.js
export const norm = (s) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
