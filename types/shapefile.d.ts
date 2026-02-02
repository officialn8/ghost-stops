declare module 'shapefile' {
  export function open(path: string): Promise<{
    read: () => Promise<{ done: boolean; value?: { properties: any; geometry: any } }>;
  }>;
}

declare module 'unzipper' {
  export function Parse(): any;
  export function Extract(options: { path: string }): any;
}