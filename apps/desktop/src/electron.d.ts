export {};
declare global {
  interface Window {lumina: LuminaBridge;}
  interface LuminaBridge {
    releaseImageMemory(reason:string):void;
    imageMemoryUsage():{images:{size:number;liveSize:number;count:number};requests:number;trims:number;lastReason:string};
    startup(status:{phase:'data'|'thumbnails'|'ready'|'error';message?:string;completed?:number;total?:number}):void;
    startupAction(action:'retry'|'quit'):void;
    onStartupStatus(callback:(status:any)=>void):()=>void;
    onStartupRetry(callback:()=>void):()=>void;
  }
  interface LuminaBridge { onAppShortcut(callback:(action:'back'|'forward'|'refresh')=>void):()=>void; onViewerEscape(callback:()=>void):()=>void; command(command: unknown): Promise<any>; thumbnail(mediaId: string,retry?:boolean): Promise<string>; mediaUrl(kind: 'thumbnail' | 'original' | 'preview' | 'playback' | 'hover', mediaId: string): string; pickFolder(): Promise<string | null>;pickImport(kind:'files'|'folders'):Promise<string[]>;clipboardFiles():Promise<string[]>;filePaths(files:File[]):string[]; native(input: { action: string; mediaIds?: string[]; directory?: string; displayId?:number; dimmed?:boolean; color?:string }): Promise<any>; startDrag(mediaIds: string[],options?:{includeHidden?:boolean}): Promise<{count:number}>; onLibraryChanged(callback: () => void): () => void; }
}
