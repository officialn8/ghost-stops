// Modules the retired-era ingest scripts import that ship no types. The scripts type check
// (tsconfig.scripts.json, CI) needs them declared; nothing in src/ imports either.
declare module "shapefile";
declare module "unzipper";
