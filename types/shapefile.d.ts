declare module 'shapefile' {
  export function open(path: string): Promise<{
    read: () => Promise<{ done: boolean; value?: { properties: any; geometry: any } }>;
  }>;
}