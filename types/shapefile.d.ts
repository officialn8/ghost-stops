/* eslint-disable @typescript-eslint/no-explicit-any -- stub declarations for two untyped third-party modules */
declare module 'shapefile' {
  export function open(shpPath: string, dbfPath?: string): Promise<{
    read: () => Promise<{ done: boolean; value?: { properties: any; geometry: any } }>;
  }>;
}

declare module 'unzipper' {
  export function Parse(): any;
  export function Extract(options: { path: string }): any;
}