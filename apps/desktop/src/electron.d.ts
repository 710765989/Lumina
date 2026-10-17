export {};
declare global {
  interface Window { lumina: { command(command: unknown): Promise<any>; pickFolder(): Promise<string | null>; }; }
}
