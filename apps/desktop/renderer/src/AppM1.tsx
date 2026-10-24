import {matchesSearch,useTagSearch} from './localized-search';
import {t,translateMessage} from './i18n';
import {MediaActivity} from './MediaActivity';
import {LanguageSettings,useLanguage} from './LanguageSettings';
import {HiddenReasonDialog,type HiddenReason} from './HiddenReasonDialog';
import {latestRequest,timelinePosition} from './latest-request';
import {SearchChip} from './SearchChip';
import {ActionButton} from './ActionControls';
import {useUiMotion} from './useUiMotion';
import {HiddenMediaPage} from './HiddenMediaPage';
import {useAppNavigation,usePageLocation} from './useAppNavigation';
import {useWindowControlColors} from './useWindowControlColors';
import {SearchTypeMenu,useSearchTypes,extensionSuggestions,normalizeExtension} from './SearchTypeMenu';
import {useLibraryFormats} from './useLibraryFormats';
import {DirectorySetupDialog} from './DirectorySetupDialog';
import type {CollectionSort} from './CollectionMediaView';
import {TagEditor} from './TagEditor';
import {ToggleSwitch} from './ToggleSwitch';
import {userErrorMessage} from './user-error';
import {useHomeKeyboard} from './useHomeKeyboard';
import {LibraryTimeAxis,type TimelineMonth} from './LibraryTimeAxis';
import {startBackgroundJob,BackgroundTaskNotice} from './BackgroundTaskNotice';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VirtualMediaGrid } from './VirtualMediaGrid';
import { TimelineGrid as GroupedMediaGrid } from './TimelineGrid';
import { AlbumPickerDialog, LibraryConfirmDialog, LibraryFormDialog } from './LibraryDialogs';
import { TagsPage } from './TagsPage';
import { AlbumsPage } from './AlbumsPage';
import { OrganizationPage, ExportDialog, DeleteDialog, JobDialog } from './OrganizationPages';
import { MediaViewer } from './MediaViewer';
import { tagLabel,tagOccurrences } from '@lumina/contracts';
import { TagAutocomplete } from './TagAutocomplete';
import {useDismissableLayer} from './useDismissableLayer';
import { useModalEscape } from './useModalEscape';
import type { PlaybackSource } from './usePlayback';
import { MediaDetailsDialog } from './MediaDetailsDialog';
import {CacheSettings} from './CacheSettings';
import {useStartup} from './useStartup';
import {DirectorySettings} from './DirectorySettings';
import {ImportSettings,ImportController,requestImport} from './MediaImport';
import { OrganizationSettings, TaskManager, TaskDrawer } from './OrganizationSettings';
import type { Album, Tag } from './media-types';

type Root = { id: string; absolutePath: string; label: string; enabled: boolean };
type Media = { id: string; absolutePath: string; kind: string; hidden: boolean; sizeBytes: number; modifiedAtMs: number; capturedAtMs?: number | null; fingerprint?: string; metadata?: Record<string, any> };
type Task = { id: string; kind: string; status: string; processed: number; total: number; errorCode: string | null; errorMessage: string | null; payloadJson: string | null };
type ContextMenu = { item: Media; x: number; y: number };
type TagSummary = { name: string;englishName?:string; count: number };
type MediaStats = { total: number; photo: number; video: number; totalSizeBytes: number; photoSizeBytes?: number; videoSizeBytes?: number };
type SearchChip = { untagged?:boolean;id: string; type: 'file' | 'excludeFile' | 'extension' | 'tag' | 'excludeTag'; value: string };
type SearchMode = SearchChip['type'];
type SortBy = 'fileTime' | 'capturedAt' | 'name' | 'size';

const sortLabels: Record<SortBy, string> = {
  fileTime: '按文件时间',
  capturedAt: '按拍摄时间',
  name: '按文件名',
  size: '按文件大小',
};



function fileName(filePath: string): string { return filePath.split(/[\\/]/u).pop() ?? filePath; }
function descriptionText(description: string): string { return description.replace(/\\n/gu, ' ').replace(/\s+/gu, ' ').trim(); }
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = units[0]!;
  for (const next of units) { value /= 1024; unit = next; if (value < 1024 || next === 'TB') break; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

export function AppM1() {
  const language=useLanguage();
  const [startupLoaded,setStartupLoaded]=useState(false),[startupError,setStartupError]=useState('');
  const startupDataReady=useRef(false),startupDirty=useRef(false);
  useStartup(startupLoaded,startupError);
  useWindowControlColors();useUiMotion();
  useEffect(()=>window.lumina.onViewerEscape(()=>(document.activeElement??document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))),[]);
  const [directorySetup,setDirectorySetup]=useState<{absolutePath:string;root?:Root}|null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaStats, setMediaStats] = useState<MediaStats>({ total: 0, photo: 0, video: 0, totalSizeBytes: 0 });
  const [viewStats,setViewStats]=useState<MediaStats>({total:0,photo:0,video:0,totalSizeBytes:0});
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumEditor, setAlbumEditor] = useState<Album | 'create' | null>(null);
  const [albumPickerMediaIds, setAlbumPickerMediaIds] = useState<string[] | null>(null);
  const [albumDeleting, setAlbumDeleting] = useState<Album | null>(null);
  const [tagMedia, setTagMedia] = useState<Media[]>([]);
  const [hiddenSort,setHiddenSort]=useState<CollectionSort & {kind?:'photo'|'video'}>({sortBy:'fileTime',sort:'desc'});
  const [playbackTagId,setPlaybackTagId]=useState<string|null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  useTagSearch(tags);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Media | null>(null);
  const [viewerWindow,setViewerWindow]=useState<Media[]>([]);
  const [playbackRevision,setPlaybackRevision]=useState(0);
  const [detailMedia, setDetailMedia] = useState<Media | null>(null);
  const [detailTags, setDetailTags] = useState<Tag[]>([]);
  const [slideshow, setSlideshow] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const searchBuilderRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canLoadMoreAlbum, setCanLoadMoreAlbum] = useState(false);
  const [loadingMoreAlbum, setLoadingMoreAlbum] = useState(false);
  const [albumMedia, setAlbumMedia] = useState<Media[]>([]);
  const [active, setActive] = useState<'library' | 'albums' | 'tags' | 'settings' | 'trash' | 'hidden' | 'geo' | 'duplicates'>('library');
  const [extraByPage,setExtraByPage]=useState<Record<string,Media[]>>({});
  const extraMedia=extraByPage[active]??[];
  const extraHandlers=useRef(Object.fromEntries(['trash','hidden','geo','duplicates'].map((page)=>[page,(items:Media[])=>setExtraByPage((current)=>({...current,[page]:items}))]))).current;
  useEffect(()=>{window.lumina.releaseImageMemory(preview?'viewer-step':'page-change');},[active,preview?.id]);
  const [visitedPages,setVisitedPages]=useState(new Set(['library']));
  function navigate(page:typeof active){
    if(page===active){clearSelection();window.dispatchEvent(new CustomEvent('lumina-page-home',{detail:page}));if(page==='library'){setTimeAnchor(null);setQuery('');setSearchInput('');setSearchChips([]);setSearchModeSelected(false);setSearchMenuOpen(false);setMediaFilter('all');document.querySelector('.library-content .grouped-media-scroll')?.scrollTo(0,0);}}
    else {setVisitedPages((current)=>new Set([...current,page]));setActive(page);setSearchMenuOpen(false);}
  }
  useAppNavigation(active,page=>{clearSelection();setVisitedPages(current=>new Set([...current,page]));setActive(page);setSearchMenuOpen(false);setContextMenu(null);},()=>refresh({preserveLoaded:true}).then(clearSelection),error=>setMessage(userErrorMessage(error)),{location:preview?{item:preview,slideshow}:null,restore:async(location:{item:Media;slideshow:boolean}|null)=>{if(location)await window.lumina.command({type:'media.filePath',id:location.item.id});setPreview(location?.item??null);setSlideshow(location?.slideshow??false);}});
  const [homeView,setHomeView]=useState<'time'|'immersive'|'masonry'|'list'>(()=>{if(!localStorage.getItem('lumina.home.immersiveDefault'))return 'immersive';const value=localStorage.getItem('lumina.home.view');return value==='time'||value==='masonry'||value==='list'?value:'immersive';});
  const [homeGridView,setHomeGridView]=useState<'time'|'immersive'|'masonry'>(()=>homeView==='masonry'||localStorage.getItem('lumina.home.gridView')==='masonry'?'masonry':homeView==='time'||localStorage.getItem('lumina.home.gridView')==='time'?'time':'immersive');
  function chooseHomeView(value:typeof homeView){if(value!=='list')setHomeGridView(value);setHomeView(value);}
  const [thumbnailSize,setThumbnailSize]=useState(()=>Math.max(110,Math.min(320,Number(localStorage.getItem('lumina.home.size'))||165)));
  useEffect(()=>{localStorage.setItem('lumina.home.immersiveDefault','1');localStorage.setItem('lumina.home.view',homeView);localStorage.setItem('lumina.home.size',String(thumbnailSize));localStorage.setItem('lumina.home.gridView',homeGridView);},[homeView,homeGridView,thumbnailSize]);
  const [recentTags,setRecentTags]=useState<Tag[]>([]);const [tagPreferences,setTagPreferences]=useState<{order:'recent'|'name';recentIds:string[]}>({order:'recent',recentIds:[]});const [tagChildParent,setTagChildParent]=useState<Tag|null>(null);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if(event.key!=='Backspace' || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]') || document.querySelector('[role=dialog]'))return;event.preventDefault();window.dispatchEvent(new CustomEvent('lumina-page-back',{detail:active}));};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[active]);
  const homeWheel=useRef<HTMLElement>(null);
  useEffect(()=>{const element=homeWheel.current;if(!element || active!=='library')return;const wheel=(event:WheelEvent)=>{if(!event.ctrlKey)return;event.preventDefault();if(event.deltaY>0 && thumbnailSize<=110){setHomeView('list');return;}if(homeView==='list' && event.deltaY<0){setHomeView(homeGridView);setThumbnailSize(110);return;}setThumbnailSize((value)=>Math.max(110,Math.min(320,value+(event.deltaY<0?15:-15))));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[active,homeView,homeGridView,thumbnailSize]);
  const [organizationRevision, setOrganizationRevision] = useState(0);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [forcePermanent, setForcePermanent] = useState(false);
  const [idlePlayback,setIdlePlayback]=useState(false);
  const [albumUndo,setAlbumUndo]=useState<{token:string;count:number;smart:boolean;name:string}|null>(null);const [albumUndoBusy,setAlbumUndoBusy]=useState(false);
  const [undoTrashIds,setUndoTrashIds]=useState<string[]>([]);const [undoBusy,setUndoBusy]=useState(false);const [undoError,setUndoError]=useState('');
  useEffect(()=>{if(!undoTrashIds.length || undoBusy)return;const timer=window.setTimeout(()=>setUndoTrashIds([]),8000);return()=>window.clearTimeout(timer);},[undoTrashIds,undoBusy]);
  const albumMoreRef=useRef<()=>void>(()=>{});const tagMoreRef=useRef<()=>void>(()=>{});
  const registerAlbumMore=useCallback((load:()=>void)=>{albumMoreRef.current=load;},[]);const registerTagMore=useCallback((load:()=>void)=>{tagMoreRef.current=load;},[]);
  const [trashPurgeIds, setTrashPurgeIds] = useState<string[] | null>(null);
  const [exporting, setExporting] = useState<{ mediaIds?: string[]; albumId?: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [taskDrawerOpen,setTaskDrawerOpen]=useState(false);
  const [pendingDeletes,setPendingDeletes]=useState<{id:string;mode:string}[]>([]);const [activeTaskCount,setActiveTaskCount]=useState(0);
  useEffect(()=>{let disposed=false;const load=()=>void window.lumina.command({type:'tasks.activity'}).then((result)=>{if(!disposed)setActiveTaskCount(result.active);}).catch(()=>{});load();const timer=window.setInterval(load,1500);return()=>{disposed=true;window.clearInterval(timer);};},[]);
  const [albumSort,setAlbumSort]=useState<CollectionSort>({sortBy:'fileTime',sort:'desc'});const [tagSort,setTagSort]=useState<CollectionSort>({sortBy:'fileTime',sort:'desc'});
  const [m2Album, setM2Album] = useState<Album | null>(null);
  const handleAlbumChange = useCallback((album: Album | null) => { setM2Album(album); setSelectedAlbumId(album?.id ?? null); }, []);
  const [settingsSection, setSettingsSection] = useState<'general' | 'theme' | 'account' | 'about'>('general');
  usePageLocation('settings',{section:settingsSection},location=>{if(location?.section)setSettingsSection(location.section);},()=>refresh({preserveLoaded:true}));
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editMode,setEditMode]=useState(false);const [rootSwitchBusy,setRootSwitchBusy]=useState(new Set<string>());
  const selectionAnchorRef = useRef<string | null>(null);
  const selectionCursorRef=useRef<string|null>(null);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('tag');
  const [searchModeSelected, setSearchModeSelected] = useState(false);
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const searchTypes=useSearchTypes(selectSearchMode,tagged=>addSearchChip('无',true,tagged?'excludeTag':'tag'));
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(0);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'photo' | 'video'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('fileTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [timelineMonths,setTimelineMonths]=useState<TimelineMonth[]>([]);
  const [timeAnchor,setTimeAnchor]=useState<string|null>(null);
  const [timeJump,setTimeJump]=useState(0);const [mediaStart,setMediaStart]=useState(0);
  const mediaWindow=useRef({key:'',start:0,end:0});
  const [timeSeeking,setTimeSeeking]=useState(false),[timeSeekError,setTimeSeekError]=useState('');
  const timeSeekingRef=useRef(false),lastSeek=useRef(0);
  const timelineWindows=useRef(new Map<string,{records:Media[];start:number;total:number}>());
  const timelineQueue=useRef<ReturnType<typeof latestRequest<{key:string;cacheKey:string;start:number;total:number;request:Record<string,unknown>}>>>();

  useEffect(()=>setTimeAnchor(null),[query,searchChips,mediaFilter,sortBy,sortDirection]);
  function jumpMonthReset(){timeSeekingRef.current=true;setTimeSeeking(true);setTimeSeekError('');clearSelection();setTimeAnchor(null);setTimeJump(value=>value+1);document.querySelector('.library-content .grouped-media-scroll')?.scrollTo(0,0);}
  function jumpMonth(month:string){timeSeekingRef.current=true;setTimeSeeking(true);setTimeSeekError('');clearSelection();setTimeAnchor(month);setTimeJump(value=>value+1);document.querySelector('.library-content .grouped-media-scroll')?.scrollTo(0,0);}

  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortControlRef=useRef<HTMLDivElement>(null);
  useDismissableLayer(sortMenuOpen,()=>setSortMenuOpen(false),[sortControlRef]);
  useDismissableLayer(searchMenuOpen,()=>setSearchMenuOpen(false),[searchBuilderRef]);
  useDismissableLayer(Boolean(contextMenu),()=>setContextMenu(null),[contextMenuRef]);
  const formatSuggestions=useLibraryFormats(active==='library'&&searchMenuOpen&&searchModeSelected&&searchMode==='extension');
  const [fileSuggestions,setFileSuggestions]=useState<{name:string;count:number}[]>([]);
  useEffect(()=>{
    let valid=true;setFileSuggestions([]);
    if(!searchMenuOpen || !searchModeSelected || !['file','excludeFile'].includes(searchMode) || !searchInput.trim())return;
    const timer=window.setTimeout(()=>void window.lumina.command({type:'media.nameSuggestions',query:searchInput.trim()}).then((rows)=>{if(valid){setFileSuggestions(rows);setTagSuggestionIndex(0);}}).catch(()=>{}),120);
    return()=>{valid=false;window.clearTimeout(timer);};
  },[searchInput,searchMode,searchModeSelected,searchMenuOpen]);
  useEffect(()=>{void window.lumina.native({action:'dim-window-controls',dimmed:Boolean(preview)}).catch(()=>{});return()=>{void window.lumina.native({action:'dim-window-controls',dimmed:false}).catch(()=>{});};},[Boolean(preview)]);
  const [tagDialogMode, setTagDialogMode] = useState<'edit' | null>(null);
  const [tagDialogName, setTagDialogName] = useState('');
  const [tagRoot,setTagRoot]=useState<Root|null>(null);
  const [tagTargetIds,setTagTargetIds]=useState<string[]>([]);
  const [tagDialogTags, setTagDialogTags] = useState<TagSummary[]>([]);
  const [tagDialogLoading, setTagDialogLoading] = useState(false);
  const [tagBatchJob,setTagBatchJob]=useState<string|null>(null);
  const [continuousTags,setContinuousTags]=useState(()=>localStorage.getItem('lumina.tags.continuous')==='true');
  const [pendingTagJob,setPendingTagJob]=useState<{id:string;action:'add'|'remove'}|null>(null);
  useEffect(()=>{localStorage.setItem('lumina.tags.continuous',String(continuousTags));},[continuousTags]);
  useEffect(()=>{if(!pendingTagJob)return;let disposed=false;let timer:number|undefined;const poll=async()=>{try{const result=await window.lumina.command({type:'jobs.result',id:pendingTagJob.id});if(disposed)return;if(!result.active && ['completed','failed','cancelled'].includes(result.status)){setPendingTagJob(null);if(result.status==='completed' && pendingTagJob.action==='add' && !continuousTags)setTagDialogMode(null);if(result.status==='completed')setTagDialogName('');await loadTagDialogTags();return;}}catch(error){if(!disposed)setMessage(userErrorMessage(error));}if(!disposed)timer=window.setTimeout(poll,700);};void poll();return()=>{disposed=true;window.clearTimeout(timer);};},[pendingTagJob,continuousTags]);
  const [busy, setBusy] = useState(false);
  const closeTagDialog=()=>{if(!busy)setTagDialogMode(null);};
  const tagDialogRef=useModalEscape<HTMLElement>(closeTagDialog,busy);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [retryAllBusy, setRetryAllBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(()=>{const dragged=(event:Event)=>{const id=(event as CustomEvent).detail;if(typeof id==='string'){selectionAnchorRef.current=id;selectionCursorRef.current=id;}};window.addEventListener('lumina-media-drag-start',dragged);return()=>window.removeEventListener('lumina-media-drag-start',dragged);},[]);
  useEffect(()=>{const error=(event:Event)=>setMessage(userErrorMessage((event as CustomEvent).detail));window.addEventListener('lumina-action-error',error);return()=>window.removeEventListener('lumina-action-error',error);},[]);
  const [expiryRunning, setExpiryRunning] = useState(false);
  const protectedSelection = useRef<string[]>([]); protectedSelection.current = [...selected, ...(preview ? [preview.id] : [])];
  useEffect(() => {
    let running = false;
    const timer = window.setInterval(() => {
      if (running || document.querySelector('[role="dialog"],.tag-dialog') || protectedSelection.current.length) return;
      running = true; const statusTimer=window.setTimeout(()=>setExpiryRunning(true),300);
      void window.lumina.command({ type: 'trash.expired', protectedIds: protectedSelection.current }).then((results: any[]) => { if (results.some((result)=>result.ok)) setOrganizationRevision((value) => value + 1); }).catch((error) => setMessage(userErrorMessage(error))).finally(() => { running = false; window.clearTimeout(statusTimer);setExpiryRunning(false); });
    }, 60000); return () => window.clearInterval(timer);
  }, []);
  const mediaLoadingRef = useRef(false);
  const refreshingRef = useRef(false);
  const pendingRefreshRef = useRef<{ preserveLoaded?: boolean } | null>(null);
  const mediaQueryKey = JSON.stringify([language,query, searchChips, mediaFilter, sortBy, sortDirection,timeAnchor,timeJump]);
  const mediaQueryRef = useRef(mediaQueryKey); mediaQueryRef.current = mediaQueryKey;

  function mediaRequest(offset = 0, limit = 200) {
    const searching = Boolean(query.trim() || searchChips.length);
    return { type: searching ? 'media.search' : 'media.list', ...(searching ? { query: searchChips.length ? (searchModeSelected ? '' : searchInput.trim()) : query.trim(), fileNames: searchChips.filter((chip) => chip.type === 'file').map((chip) => chip.value), excludeFileNames: searchChips.filter((chip) => chip.type === 'excludeFile').map((chip) => chip.value), extensions: searchChips.filter((chip) => chip.type === 'extension').map((chip) => chip.value), tagNames: searchChips.filter((chip) => chip.type === 'tag' && !chip.untagged).map((chip) => chip.value), untaggedOnly:searchChips.some((chip)=>chip.type==='tag' && chip.untagged),excludeUntagged:searchChips.some((chip)=>chip.type==='excludeTag' && chip.untagged),excludeTagNames: searchChips.filter((chip) => chip.type === 'excludeTag' && !chip.untagged).map((chip) => chip.value) } : {}), ...(mediaFilter === 'all' ? {} : { kind: mediaFilter }), sortBy, sort: sortDirection, offset, limit };
  }

  function seekMonth(){
    const key=mediaQueryKey,scope=JSON.stringify([language,query,searchChips,mediaFilter,sortBy,sortDirection]),cacheKey=scope+':'+(timeAnchor??'start');
    const {start,total,bounds}=timelinePosition(timelineMonths,timeAnchor,sortDirection),base=mediaRequest(0,60);
    if(!timelineQueue.current)timelineQueue.current=latestRequest(async position=>{
      try{
        if(position.key!==mediaQueryRef.current)return;
        const cached=timelineWindows.current.get(position.cacheKey),records=cached?.records??await window.lumina.command(position.request) as Media[];
        if(position.key!==mediaQueryRef.current)return;
        const resultWindow={records,start:cached?.start??position.start,total:cached?.total??position.total};
        timelineWindows.current.delete(position.cacheKey);timelineWindows.current.set(position.cacheKey,resultWindow);
        while(timelineWindows.current.size>6)timelineWindows.current.delete(timelineWindows.current.keys().next().value!);
        mediaWindow.current={key:position.key,start:resultWindow.start,end:resultWindow.start+records.length};setMediaStart(resultWindow.start);setMedia(records);setCanLoadMore(resultWindow.start+records.length<resultWindow.total);selectionAnchorRef.current=null;
      }catch(error){if(position.key===mediaQueryRef.current){setTimeSeekError(userErrorMessage(error));setMessage(userErrorMessage(error));}}
      finally{if(position.key===mediaQueryRef.current){timeSeekingRef.current=false;setTimeSeeking(false);const pending=pendingRefreshRef.current;pendingRefreshRef.current=null;if(pending)queueMicrotask(()=>void refreshLatest.current(pending).catch(error=>setMessage(userErrorMessage(error))));}}
    });
    timeSeekingRef.current=true;setTimeSeeking(true);setTimeSeekError('');
    void timelineQueue.current({key,cacheKey,start,total,request:{...base,type:'media.search',query:('query' in base?base.query:'')??'',...bounds}});
  }

  async function refresh(options: { preserveLoaded?: boolean } = {}) {
    if (mediaLoadingRef.current || refreshingRef.current || timeSeekingRef.current) { pendingRefreshRef.current = options; return; }
    refreshingRef.current = true;timelineWindows.current.clear();setTimeSeekError('');
    try {
    const key = mediaQueryKey;
    const targetCount = options.preserveLoaded ? Math.max(200, media.length) : 200;
    // A month is a position within the full query, never a filter on its scope.
    const monthsPromise:Promise<TimelineMonth[]>=sortBy==='fileTime' || sortBy==='capturedAt' ? window.lumina.command({...mediaRequest(),type:'media.timeline',query:mediaRequest().query??''}) : Promise.resolve([]);
    const fetchMedia = async () => {
      const months=await monthsPromise;let start=0;
      if(options.preserveLoaded && mediaWindow.current.key===key)start=mediaWindow.current.start;
      else if(timeAnchor && months.length){for(const month of months){if(sortDirection==='asc'?month.month>=timeAnchor:month.month<=timeAnchor)break;start+=month.count;}}
      const total=months.reduce((sum,month)=>sum+month.count,0);if(months.length)start=Math.min(start,Math.max(0,total-1));
      const records: Media[] = []; let batch: Media[] = [];
      do { const limit = Math.min(1000, targetCount - records.length); batch = await window.lumina.command(mediaRequest(start+records.length, limit)); records.push(...batch); if (batch.length < limit) break; } while (records.length < targetCount);
      return {records,start};
    };
    const mediaOptions = {
      ...(mediaFilter === 'all' ? {} : { kind: mediaFilter }),
      sortBy,
      sort: sortDirection,
      limit: 200,
    };
    const hasStructuredSearch = searchChips.length > 0;
    const [nextRoots, nextMedia, nextAlbums, nextTags, nextTasks, nextMediaStats,nextViewStats,nextMonths,nextTagPreferences] = await Promise.all([
      window.lumina.command({ type: 'roots.list' }),
      fetchMedia(),
      window.lumina.command({ type: 'albums.list' }),
      window.lumina.command({ type: 'tags.list' }),
      window.lumina.command({ type: 'tasks.list', limit: 50 }),
      window.lumina.command({ type: 'media.stats' }),
      window.lumina.command({...mediaRequest(),type:'media.filteredStats',timeBeforeMs:undefined,timeFromMs:undefined,query:mediaRequest().query??''}),
      monthsPromise,
      window.lumina.command({type:'tags.searchPreferences'}),
    ]);
    const nextMediaRecords = nextMedia.records;
    if (key !== mediaQueryRef.current) return;
    mediaWindow.current={key,start:nextMedia.start,end:nextMedia.start+nextMedia.records.length};setMediaStart(nextMedia.start);
    timelineWindows.current.set(JSON.stringify([query,searchChips,mediaFilter,sortBy,sortDirection])+':'+(timeAnchor??'start'),{records:nextMediaRecords,start:nextMedia.start,total:nextMonths.reduce((sum,month)=>sum+month.count,0)});
    const previousVersions=new Map(media.map((record)=>[record.id,record.fingerprint]));
    const changed = new Set(nextMediaRecords.filter((record) => previousVersions.has(record.id) && previousVersions.get(record.id)!==record.fingerprint).map((record)=>record.id));
    if(media.length!==nextMediaRecords.length || media.some((record,index)=>record.id!==nextMediaRecords[index]?.id))selectionAnchorRef.current=null;
    if (changed.size) { setThumbnails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !changed.has(id)))); setThumbnailErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !changed.has(id)))); }
    setTagPreferences(nextTagPreferences);setRoots(nextRoots as Root[]); setMedia(nextMediaRecords); setAlbums((current)=>JSON.stringify(current)===JSON.stringify(nextAlbums)?current:nextAlbums as Album[]); setTags((current)=>JSON.stringify(current)===JSON.stringify(nextTags)?current:nextTags as Tag[]); setTasks(nextTasks as Task[]); setMediaStats(nextMediaStats as MediaStats);setViewStats((nextViewStats??nextMediaStats) as MediaStats);
    setTimelineMonths(current=>JSON.stringify(current)===JSON.stringify(nextMonths)?current:nextMonths as TimelineMonth[]);setCanLoadMore(nextMediaRecords.length === targetCount);
    startupDataReady.current=true;setStartupLoaded(true);setStartupError('');if(startupDirty.current){startupDirty.current=false;pendingRefreshRef.current={preserveLoaded:true};}
    } finally {
      refreshingRef.current = false;
      const pending = pendingRefreshRef.current; pendingRefreshRef.current = null;
      if (pending) queueMicrotask(() => void refreshLatest.current(pending).catch((error) => setMessage(userErrorMessage(error))));
    }
  }

  // Tag edits do not change unfiltered media order or loaded page boundaries.
  async function refreshTagChanges() {
    setTags(await window.lumina.command({ type: 'tags.list' }) as Tag[]);setTagPreferences(await window.lumina.command({type:'tags.searchPreferences'}));
    const nextAlbums=await window.lumina.command({type:'albums.list'});setAlbums((current)=>JSON.stringify(current)===JSON.stringify(nextAlbums)?current:nextAlbums as Album[]);
    setOrganizationRevision((value) => value + 1);
    if (query.trim() || searchChips.some((chip) => chip.type !== 'file')) await refresh({ preserveLoaded: true });
  }

  async function refreshTasks() {
    try { setTasks(await window.lumina.command({ type: 'tasks.list', limit: 50 }) as Task[]); } catch { /* task status is auxiliary UI */ }
  }

  async function refreshRoots() {
    setRoots(await window.lumina.command({ type: 'roots.list' }) as Root[]);
  }

  async function refreshAlbum(albumId: string) {
    const result = await window.lumina.command({ type: 'albums.media', id: albumId, limit: 200 });
    const records = result as Media[];
    setAlbumMedia(records);
    setCanLoadMoreAlbum(records.length === 200);
  }

  const thumbnailPending=useRef(new Set<string>()),thumbnailQueue=useRef(new Map<string,Media>());
  const thumbnailCache=useRef(thumbnails),thumbnailFailures=useRef(thumbnailErrors),thumbnailVersions=useRef(new Map<string,string|undefined>());
  thumbnailCache.current=thumbnails;thumbnailFailures.current=thumbnailErrors;
  const thumbnailWorkers=useRef(0);
  useEffect(()=>{const cleared=()=>{thumbnailCache.current={};thumbnailFailures.current={};thumbnailQueue.current.clear();setThumbnails({});setThumbnailErrors({});};window.addEventListener('lumina-cache-cleared',cleared);return()=>window.removeEventListener('lumina-cache-cleared',cleared);},[]);
  function pumpThumbnails(){
    while(thumbnailWorkers.current<3 && thumbnailQueue.current.size){
      const record=[...thumbnailQueue.current.values()].find(record=>!thumbnailPending.current.has(record.id));if(!record)break;thumbnailQueue.current.delete(record.id);
      if(thumbnailCache.current[record.id] || thumbnailFailures.current[record.id] || thumbnailPending.current.has(record.id))continue;
      thumbnailPending.current.add(record.id);thumbnailWorkers.current++;
      void window.lumina.thumbnail(record.id).then(url=>{
        if(thumbnailVersions.current.get(record.id)!==record.fingerprint)return;
        thumbnailCache.current={...thumbnailCache.current,[record.id]:url};setThumbnails(current=>({...current,[record.id]:url}));
      }).catch(reason=>{thumbnailFailures.current={...thumbnailFailures.current,[record.id]:userErrorMessage(reason)};setThumbnailErrors(current=>({...current,[record.id]:userErrorMessage(reason)}));}).finally(()=>{thumbnailPending.current.delete(record.id);thumbnailWorkers.current--;pumpThumbnails();});
    }
  }
  const handleVisibleMedia=useCallback((records:Media[])=>{
    // Drop stale queued work when scrolling/zooming; active decodes finish safely.
    thumbnailQueue.current=new Map(records.filter(record=>record.kind==='photo'||record.kind==='video').map(record=>[record.id,record]));
    for(const record of records)thumbnailVersions.current.set(record.id,record.fingerprint);
    pumpThumbnails();
  },[]);

  async function loadMoreMedia() {
    if (timeSeekingRef.current || mediaLoadingRef.current || refreshingRef.current || mediaWindow.current.key!==mediaQueryKey || !canLoadMore) return;
    const key = mediaQueryKey,end=mediaWindow.current.end;
    mediaLoadingRef.current = true;
    setLoadingMore(true);
    try {
      const next = await window.lumina.command(mediaRequest(end)) as Media[];
      if (key !== mediaQueryRef.current) return;
      if(mediaWindow.current.end!==end)return;
      mediaWindow.current={...mediaWindow.current,end:end+next.length};
      setMedia(current=>{const existing=new Set(current.map(item=>item.id));return [...current,...next.filter(item=>!existing.has(item.id))];});setCanLoadMore(next.length === 200);
    } catch (error) { setMessage(userErrorMessage(error)); } finally {
      mediaLoadingRef.current = false; setLoadingMore(false);
      const pending = pendingRefreshRef.current; pendingRefreshRef.current = null;
      if (pending) queueMicrotask(() => void refreshLatest.current(pending).catch((error) => setMessage(userErrorMessage(error))));
    }
  }

  async function loadPreviousMedia() {
    if(timeSeekingRef.current || mediaLoadingRef.current || refreshingRef.current || mediaWindow.current.key!==mediaQueryKey || mediaWindow.current.start<=0)return;
    const key=mediaQueryKey,previousStart=mediaWindow.current.start,start=Math.max(0,previousStart-200);
    mediaLoadingRef.current=true;
    try{
      const next=await window.lumina.command(mediaRequest(start,previousStart-start)) as Media[];
      if(key!==mediaQueryRef.current)return;
      mediaWindow.current={...mediaWindow.current,key,start};setMediaStart(start);
      setMedia(current=>{const existing=new Set(current.map(item=>item.id));return [...next.filter(item=>!existing.has(item.id)),...current];});
    }catch(error){setMessage(userErrorMessage(error));}finally{
      mediaLoadingRef.current=false;
      const pending=pendingRefreshRef.current;pendingRefreshRef.current=null;
      if(pending)queueMicrotask(()=>void refreshLatest.current(pending).catch(error=>setMessage(userErrorMessage(error))));
    }
  }

  async function loadMoreAlbumMedia() {
    if (loadingMoreAlbum || !selectedAlbumId || !canLoadMoreAlbum) return;
    setLoadingMoreAlbum(true);
    try {
      const next = await window.lumina.command({ type: 'albums.media', id: selectedAlbumId, limit: 200, offset: albumMedia.length }) as Media[];
      setAlbumMedia((current) => [...current, ...next]);
      setCanLoadMoreAlbum(next.length === 200);
    } finally { setLoadingMoreAlbum(false); }
  }

  const refreshEffectKey=useRef<string|null>(null);
  useEffect(() => {if(refreshEffectKey.current===mediaQueryKey)return;refreshEffectKey.current=mediaQueryKey;if(lastSeek.current!==timeJump&&startupDataReady.current){lastSeek.current=timeJump;seekMonth();return;}lastSeek.current=timeJump;timeSeekingRef.current=false;setTimeSeeking(false);setTimeSeekError('');void refresh().catch((error) => {setMessage(userErrorMessage(error));if(!startupLoaded)setStartupError(userErrorMessage(error));}); }, [language,query, searchChips, mediaFilter, sortBy, sortDirection,timeAnchor,timeJump]);
  useEffect(() => { setSelected(new Set()); selectionAnchorRef.current = null;selectionCursorRef.current=null; }, [query, searchChips, mediaFilter, sortBy, sortDirection,timeAnchor,timeJump]);
  useEffect(() => { setSelected(new Set()); selectionAnchorRef.current = null;selectionCursorRef.current=null; }, [selectedAlbumId]);
  useEffect(() => { setSelected(new Set()); selectionAnchorRef.current = null;selectionCursorRef.current=null; }, [active]);
  const refreshLatest = useRef(refresh); refreshLatest.current = refresh;
  useEffect(()=>window.lumina.onStartupRetry(()=>{setStartupError('');void refreshLatest.current().catch(error=>setStartupError(userErrorMessage(error)));}),[]);
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = window.lumina.onLibraryChanged(() => {timelineWindows.current.clear();if(!startupDataReady.current){startupDirty.current=true;return;} if(timer !== undefined)return; timer = window.setTimeout(() => { timer=undefined; void refreshLatest.current({ preserveLoaded: true }).then(() => setOrganizationRevision((value) => value + 1)).catch((error) => setMessage(userErrorMessage(error))); }, 500); });
    return () => { unsubscribe(); window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if(active==='settings' && settingsSection==='general')void refreshTasks();
  }, [active,settingsSection]);
  useEffect(() => {
    if (!preview) setSlideshow(false);
  }, [preview]);
  useEffect(() => {
    if (preview?.kind === 'video') videoRef.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      setContextMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [contextMenu]);
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const x = Math.min(Math.max(contextMenu.x, 8), maxX);
    const y = Math.min(Math.max(contextMenu.y, 8), maxY);
    if (x === contextMenu.x && y === contextMenu.y) return;
    setContextMenu((current) => current ? { ...current, x, y } : null);
  }, [contextMenu]);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function addFolder() {const folder=await window.lumina.pickFolder();if(!folder)return;const key=(value:string)=>value.replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase();if(roots.some(root=>key(root.absolutePath)===key(folder))){setMessage(t("该目录已添加，请在目录设置中编辑"));return;}setDirectorySetup({absolutePath:folder});}

  async function rescanRoot(root:Root){
    setTaskBusyId(root.id);try{const result=await window.lumina.command({type:'roots.scan',id:root.id});await refresh({preserveLoaded:true});setMessage(t("扫描完成，识别 {0} 项；跳过/失败明细见任务状态", [result.media.length]));}catch(error){setMessage(userErrorMessage(error));}finally{setTaskBusyId(null);}
  }

  useHomeKeyboard({editMode,active:active==='library'&&!timeSeeking,items:media,selected,onSelect:setSelected,anchor:selectionAnchorRef,cursor:selectionCursorRef,loadMore:loadMoreMedia,loadPrevious:loadPreviousMedia,isLoading:()=>mediaLoadingRef.current||refreshingRef.current,hasPrevious:mediaStart>0,hasMore:canLoadMore,view:homeView,queryKey:mediaQueryKey,request:mediaRequest()});
  function toggleSelected(id: string, event: React.MouseEvent<HTMLElement>) {
    selectionCursorRef.current=id;
    const items = active === 'albums' && selectedAlbumId ? albumMedia : active === 'tags' ? tagMedia : ['trash','hidden','geo','duplicates'].includes(active) ? extraMedia : media;
    const targetIndex = items.findIndex((item) => item.id === id);
    const anchorId = selectionAnchorRef.current;
    const anchorIndex = anchorId ? items.findIndex((item) => item.id === anchorId) : -1;
    if (event.shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const range = new Set(items.slice(start, end + 1).map((item) => item.id));
      setSelected((current) => {
        if (!event.ctrlKey && !((active==='library'||active==='hidden') && editMode)) return range;
        const next = new Set(current);
        for (const rangeId of range) {if((active==='library'||active==='hidden') && editMode && next.has(rangeId))next.delete(rangeId);else next.add(rangeId);}
        return next;
      });
      if((active==='library'||active==='hidden') && editMode)selectionAnchorRef.current=id;
      return;
    }
    selectionAnchorRef.current = id;
    setSelected((current) => {
      if (!event.ctrlKey && !((active==='library'||active==='hidden') && editMode)) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set()); selectionAnchorRef.current = null;selectionCursorRef.current=null;
  }

  function handleLibraryBlankClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (editMode || target.closest('.media-card,.media-row,button,input,textarea,select,.selection-context')) return;
    clearSelection();
  }

  function addSearchChip(valueOverride?: string,untagged=false,modeOverride?:SearchMode) {
    let value = (valueOverride ?? searchInput).trim(); if (!value) return;if((modeOverride??searchMode)==='extension'){const ext=normalizeExtension(value);if(!/^[a-z0-9]{1,20}$/u.test(ext))return;value=`.${ext}`;}
    if (!searchModeSelected && !modeOverride) { setQuery(value); return; }
    const next = [...searchChips, { id: crypto.randomUUID(), type: modeOverride??searchMode, value,untagged }];
    setSearchChips(next); setQuery(next.map((chip) => chip.value).join(' ')); setSearchInput(''); setSearchModeSelected(false); setSearchMenuOpen(true); searchTypes.reset(); setTagSuggestionIndex(0);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeSearchChip(id: string) {
    const next = searchChips.filter((chip) => chip.id !== id);
    setSearchChips(next); setQuery(next.map((chip) => chip.value).join(' '));
    if (next.length === 0) { setSearchModeSelected(false); setSearchInput(''); }
  }

  function selectSearchMode(mode: SearchMode) {
    searchTypes.reset();setSearchMode(mode); setSearchModeSelected(true); setSearchInput(''); setQuery(''); setSearchMenuOpen(mode==='extension'); setTagSuggestionIndex(0);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function selectSearchSuggestion(value: string,untagged=false) {
    setSearchInput(value); addSearchChip(value,untagged);
  }

  function handleSearchFocus() {
    setSearchMenuOpen(true);
    if (!searchModeSelected) { setSearchMode('tag'); searchTypes.reset(); }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if(!searchModeSelected && searchMenuOpen && searchTypes.key(event.key)){event.preventDefault();return;}
    if(event.key==='Escape'){event.preventDefault();setSearchMenuOpen(false);return;}
    if (searchMenuOpen && searchModeSelected && searchOptions().length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setTagSuggestionIndex((current) => (current + step + searchOptions().length) % searchOptions().length);
      return;
    }
    if (event.key === 'Backspace' && !searchInput) {
      event.preventDefault();
      if (searchModeSelected) {
        setSearchModeSelected(false); setSearchMenuOpen(true); searchTypes.reset(); return;
      }
      const lastChip = searchChips.at(-1);
      if (lastChip) { removeSearchChip(lastChip.id); setSearchMenuOpen(true); }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!searchModeSelected) {setSearchMenuOpen(true);searchTypes.key('Enter');return;}
      if (searchMenuOpen && searchOptions().length > 0) {
        selectSearchSuggestion(searchOptions()[tagSuggestionIndex]?.name ?? searchInput,searchOptions()[tagSuggestionIndex]?.untagged); return;
      }
      addSearchChip();
    }
  }

  function searchOptions():{name:string;label:string;untagged?:boolean}[] {
    if(searchMode==='extension')return extensionSuggestions(searchInput,formatSuggestions).map(row=>({name:row.value,label:row.label}));
    if(searchMode!=='file'&&searchMode!=='excludeFile'){const tags=(searchInput.trim()?matchingTags(searchInput):orderedTags().slice(0,10)).map((tag)=>({name:tag.name,label:`${tag.directory?'▱ ':'#'}${tag.path??tagLabel(tag)}`}));if(!tags.length && searchInput.trim())tags.push({name:searchInput.trim(),label:t("#{0}（按名称搜索）", [searchInput.trim()])});return tags;}
    if(!searchInput.trim())return [];
    const rows=fileSuggestions.map((row)=>({name:row.name,label:row.count>1?t("{0} · {1} 项", [row.name, row.count]):row.name}));
    if(!rows.some((row)=>row.name.toLocaleLowerCase()===searchInput.trim().toLocaleLowerCase()))rows.push({name:searchInput.trim(),label:t("搜索{0}“{1}”的文件", [searchMode==='excludeFile'?t("不包含"):t("包含"), searchInput.trim()])});
    return rows;
  }
  function orderedTags():Tag[]{
    if(tagPreferences.order==='recent'){const rank=new Map(tagPreferences.recentIds.map((id,index)=>[id,index]));return [...tags].sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity) || a.name.localeCompare(b.name));}
    const seen=new Set<string>();return tagOccurrences([...tags].sort((a,b)=>a.name.localeCompare(b.name))).filter(tag=>{if(seen.has(tag.id))return false;seen.add(tag.id);return true;});
  }
  function matchingTags(value:string,ordinaryOnly=false):Tag[]{
    const normalized=value.trim().toLocaleLowerCase();if(!normalized)return (tagPreferences.order==='recent'&&ordinaryOnly?recentTags:orderedTags()).filter(tag=>!ordinaryOnly||!tag.directory).slice(0,10);
    return orderedTags().filter(tag=>(!ordinaryOnly||!tag.directory)&&[tag.name,tag.englishName??'',...(tag.aliases??[])].some(name=>matchesSearch(name,normalized))).slice(0,8);
  }


  async function loadTagDialogTags(ids = tagTargetIds) {
    if (ids.length === 0) return;
    setTagDialogLoading(true);
    try {
      const counts = new Map<string, TagSummary>();
      for(let offset=0;offset<ids.length;offset+=1000) {
        const summaries:TagSummary[]=await window.lumina.command({type:'media.tagSummary',mediaIds:ids.slice(offset,offset+1000)});
        for(const tag of summaries)counts.set(tag.name,{...tag,count:(counts.get(tag.name)?.count??0)+tag.count});
      }
      setTagDialogTags([...counts.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) { setMessage(userErrorMessage(error)); }
    finally { setTagDialogLoading(false); }
  }

  async function openTagDialog(root?:Root, targetIds?:string[]) {
    let ids:string[];try{ids=root?await window.lumina.command({type:'roots.mediaIds',id:root.id}):targetIds??[...selected];}catch(error){setMessage(userErrorMessage(error));return;}
    if(!ids.length){if(root)setMessage(t("该目录暂无可编辑标签的已索引媒体"));return;}setTagRoot(root??null);
    setTagTargetIds(ids);setTagDialogMode('edit'); setTagDialogName(''); setRecentTags(await window.lumina.command({type:'tags.recent'})); await loadTagDialogTags(ids);
  }

  async function addTagFromDialog(value = tagDialogName) {
    const name = value.trim(); if (!name || tagTargetIds.length === 0 || busy || pendingTagJob) return;
    setBusy(true);setMessage('');
    try {
      if(!await runTagBatch(name,'add'))return;
      setTagDialogName('');if(!continuousTags)setTagDialogMode(null);await Promise.all([window.lumina.command({type:'tags.recent'}).then(setRecentTags),loadTagDialogTags()]);
    } catch (error) { setMessage(userErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function removeTagFromDialog(name: string) {
    const summary = tagDialogTags.find((tag) => tag.name === name);
    if (!summary || summary.count !== tagTargetIds.length || tagTargetIds.length === 0 || busy || pendingTagJob) return;
    setBusy(true);setMessage('');
    try {
      if(!await runTagBatch(name,'remove'))return;
      await loadTagDialogTags();
    } catch (error) { setMessage(userErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function runTagBatch(tagName:string,tagAction:'add'|'remove') {
    const job=await startBackgroundJob({type:'jobs.start',kind:'tags',rootId:tagRoot?.id,mediaIds:tagTargetIds,tagName,tagAction});
    clearSelection();
    const began=performance.now();
    while(true){
      const result=await window.lumina.command({type:'jobs.result',id:job.id,limit:1});
      if(!result.active && ['completed','failed','cancelled'].includes(result.status)){if(result.status!=='completed'){setTagBatchJob(job.id);return false;}return true;}
      if(tagTargetIds.length>100 || performance.now()-began>250){setPendingTagJob({id:job.id,action:tagAction});if(tagTargetIds.length>100)setTagBatchJob(job.id);if(!continuousTags)setTagDialogMode(null);return false;}
      await new Promise((resolve)=>setTimeout(resolve,30));
    }
  }

  function createAlbum() {
    setAlbumEditor('create');
  }

  function editAlbum(album: Album) {
    setAlbumEditor(album);
  }

  function deleteAlbum(album: Album) {
    setAlbumDeleting(album);
  }

  async function addSelectedToAlbum() {
    if (!selectedAlbumId || selected.size === 0) return;
    await window.lumina.command({ type: 'albums.addMedia', id: selectedAlbumId, mediaIds: [...selected] }); await refreshAlbum(selectedAlbumId); setSelected(new Set()); setMessage(t("已加入相册"));
  }

  async function addSelectedToNamedAlbum() {
    if (selected.size === 0) return;
    if (!albums.length) { setMessage(t("请先创建相册")); return; }
    setAlbumPickerMediaIds([...selected]);
  }

  const [hiddenReason,setHiddenReason]=useState<HiddenReason|null>(null);
  function announceVisibilityTask(id?:string){if(id)window.dispatchEvent(new CustomEvent('lumina-job-started',{detail:{id,kind:'visibility',began:Date.now()}}));}
  async function applyVisibility(ids:string[],hidden:boolean,byMedia:Record<string,string[]>={}){
    if(ids.length>1){const job=await startBackgroundJob({type:'jobs.start',kind:'visibility',includeHidden:true,mediaIds:ids,hidden,unhideTags:byMedia});setJobId(job.id);clearSelection();return;}
    const result=await window.lumina.command({type:hidden?'media.hide':'media.unhide',id:ids[0],tagIds:byMedia[ids[0]!]});announceVisibilityTask(result.taskId);
    clearSelection();timelineWindows.current.clear();if(hidden)setMedia(current=>current.filter(item=>!ids.includes(item.id)));setOrganizationRevision(value=>value+1);
    setMessage(result.taskId?(hidden?t("已隐藏；Windows 属性正在后台同步"):t("已取消隐藏；Windows 属性正在后台同步")):hidden?t("已隐藏所选媒体"):t("已取消隐藏"));
    // The coalesced library-change event refreshes counts and collections.
    // Do not hold the completed action open for an entire library refresh.
  }
  async function requestVisibility(ids:string[],hidden:boolean){
    if(!ids.length||busy)return;setBusy(true);
    try{if(!hidden){const reason=await window.lumina.command({type:'media.hiddenReasons',mediaIds:ids});if(reason.affected){setHiddenReason({ids,...reason});return;}}await applyVisibility(ids,hidden);}catch(error){setMessage(userErrorMessage(error));}finally{setBusy(false);}
  }
  async function hideSelectedMedia(){await requestVisibility([...selected],active!=='hidden');}
  async function undoSoftwareDelete(){
    if(undoTrashIds.length>1){const job=await startBackgroundJob({type:'jobs.start',kind:'restore',mediaIds:undoTrashIds});setJobId(job.id);setUndoTrashIds([]);return;}
    setUndoBusy(true);setUndoError('');try{const failed:string[]=[];let message='';for(let offset=0;offset<undoTrashIds.length;offset+=1000){const results=await window.lumina.command({type:'trash.restore',mediaIds:undoTrashIds.slice(offset,offset+1000)});for(const result of results)if(!result.ok){failed.push(result.id);message=userErrorMessage(result.error);}}setUndoTrashIds(failed);if(failed.length)setUndoError(t("{0} 项未能还原：{1}", [failed.length, message]));else setMessage(t("已撤销删除"));await refresh({preserveLoaded:true});setOrganizationRevision((value)=>value+1);}catch(error){setUndoError(userErrorMessage(error));}finally{setUndoBusy(false);}
  }

  async function deleteSelectedMedia() {
    if (selected.size === 0) return;
    setForcePermanent(false); setDeleteIds([...selected]);
  }

  async function removeSelectedFromAlbum() {
    if (!selectedAlbumId || selected.size === 0) return;
    await window.lumina.command({ type: 'albums.removeMedia', id: selectedAlbumId, mediaIds: [...selected] }); await refreshAlbum(selectedAlbumId); setSelected(new Set()); setMessage(t("已移出相册"));
  }

  async function setCover(mediaId: string | null) {
    if (!m2Album || active!=='albums') return;
    try{await window.lumina.command({ type: 'albums.setCover', id: m2Album.id, mediaId });
      setContextMenu(null);const next=await window.lumina.command({type:'albums.list'});setAlbums(next as Album[]);
      setMessage(mediaId ? t("封面已设置") : t("已恢复默认封面"));
    }catch(error){setMessage(userErrorMessage(error));}
  }
  async function removeAlbumSelection(){
    if(!m2Album||!selected.size)return;
    try{const result=await window.lumina.command({type:m2Album.kind==='smart'?'smart.exclude':'albums.removeMedia',id:m2Album.id,mediaIds:[...selected]});
      if(result.undoToken)setAlbumUndo({token:result.undoToken,count:result.removed,smart:m2Album.kind==='smart',name:m2Album.name});
      clearSelection();await refreshTagChanges();setMessage(m2Album.kind==='smart'?t("已加入排除项"):t("已从相册移出，原文件保留"));
    }catch(error){setMessage(userErrorMessage(error));}
  }
  async function undoAlbumSelection(){
    if(!albumUndo||albumUndoBusy)return;setAlbumUndoBusy(true);
    try{const result=await window.lumina.command({type:'albums.undoRemoval',token:albumUndo.token});setAlbumUndo(null);await refreshTagChanges();setMessage(t("已撤销，恢复 {0} 项相册关联", [result.restored]));}
    catch(error){setMessage(userErrorMessage(error));}finally{setAlbumUndoBusy(false);}
  }

  async function setRootEnabled(root: Root) {
    try {
      await window.lumina.command({ type: 'roots.setEnabled', id: root.id, enabled: !root.enabled });
      await refresh();
      setMessage(root.enabled ? t("目录已停用") : t("目录已启用"));
    } catch { setMessage(t("目录状态更新失败，请重试。")); }
  }
  async function removeRoot(root: Root) {
    if (!window.confirm(t("移除目录“{0}”？该目录的媒体索引和相册引用会被删除，原文件不会被删除。", [root.label]))) return;
    try {
      const result = await window.lumina.command({ type: 'roots.remove', id: root.id }) as { removedMedia?: number };
      await refresh();
      setMessage(t("目录已移除，清理 {0} 项索引，原文件未删除", [result.removedMedia ?? 0]));
    } catch { setMessage(t("目录移除失败，请重试。")); }
  }

  function openContextMenu(item: Media, event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    setContextMenu({ item, x: event.clientX, y: event.clientY });
  }

  async function openDetails(item: Media) {
    setContextMenu(null); setDetailMedia(item); setDetailTags([]);
    try { setDetailTags(await window.lumina.command({ type: 'media.tags', id: item.id }) as Tag[]); } catch { /* details remain useful without tags */ }
  }

  async function copyContextMedia() {
    if (!contextMenu) return;
    try { await window.lumina.native({ action: 'copy', mediaIds: selected.has(contextMenu.item.id) ? [...selected] : [contextMenu.item.id] }); setMessage(t("已复制；原文件可能保留 EXIF，清除 GPS 请使用脱敏导出")); }
    catch { setMessage(t("复制失败，请检查系统剪贴板权限")); }
    setContextMenu(null);
  }

  async function hideContextMedia() {
    if(!contextMenu)return;const id=contextMenu.item.id;setContextMenu(null);await requestVisibility([id],active!=='hidden');
  }

  function exportContextMedia() {
    if (contextMenu) setExporting({ mediaIds: selected.has(contextMenu.item.id) ? [...selected] : [contextMenu.item.id] }); setContextMenu(null);
  }

  async function addContextMediaToAlbum() {
    if (!contextMenu) return;
    if (!albums.length) { setMessage(t("请先创建相册")); setContextMenu(null); return; }
    setAlbumPickerMediaIds([contextMenu.item.id]); setContextMenu(null);
  }

  async function updateContextTag(action: 'add' | 'remove') {
    if (!contextMenu) return;
    const ids = selected.has(contextMenu.item.id) ? [...selected] : [contextMenu.item.id];
    setSelected(new Set(ids)); setContextMenu(null);
    setTagRoot(null);setTagTargetIds(ids);setTagDialogMode('edit'); setTagDialogName(''); setRecentTags(await window.lumina.command({type:'tags.recent'})); await loadTagDialogTags(ids);
  }

  async function viewerMediaAction(action:'copy'|'album'|'tags'|'hide'|'cover',item:Media){
    if(action==='copy'){await window.lumina.native({action:'copy',mediaIds:[item.id]});setMessage(t("已复制"));}
    else if(action==='cover'){await setCover(item.id);}
    else if(action==='album'){if(!albums.length){setMessage(t("请先创建相册"));return;}setAlbumPickerMediaIds([item.id]);}
    else if(action==='tags'){setTagRoot(null);setTagTargetIds([item.id]);setTagDialogMode('edit');setTagDialogName('');setRecentTags(await window.lumina.command({type:'tags.recent'}));await loadTagDialogTags([item.id]);}
    else{setPreview(null);await requestVisibility([item.id],active!=='hidden');setPlaybackRevision(value=>value+1);}
  }

  async function removeContextMedia() {
    if (!contextMenu) return;
    setForcePermanent(false); setDeleteIds(selected.has(contextMenu.item.id) ? [...selected] : [contextMenu.item.id]); setContextMenu(null);
  }

  async function retryTask(task:Task){
    if(task.kind!=='thumbnail')return;setTaskBusyId(task.id);
    try{const result=await window.lumina.command({type:'tasks.retryThumbnail',id:task.id});const payload=task.payloadJson?JSON.parse(task.payloadJson):{};const ids:string[]=result.mediaIds??(payload.mediaId?[payload.mediaId]:[]);setThumbnailErrors((current)=>Object.fromEntries(Object.entries(current).filter(([id])=>!ids.includes(id))));
      if(result.queued)window.dispatchEvent(new CustomEvent('lumina-job-started',{detail:{id:task.id,kind:'thumbnail',began:Date.now()}}));else if(payload.mediaId){const url=await window.lumina.thumbnail(payload.mediaId);setThumbnails((current)=>({...current,[payload.mediaId]:url}));}
      await refreshTasks();setMessage(result.queued?t("缩略图重试已加入后台队列"):t("缩略图任务已恢复"));
    }catch(error){setMessage(t("缩略图重试失败：{0}", [userErrorMessage(error)]));}finally{setTaskBusyId(null);}
  }

  async function retryAllTasks() {
    const retryable = tasks.filter((task) => task.kind === 'thumbnail' && (task.status === 'failed' || task.status === 'paused'));
    if (!retryable.length || retryAllBusy) return;
    setRetryAllBusy(true);
    try {
      for (const task of retryable) await retryTask(task);
      await refreshTasks();
      setMessage(t("已完成 {0} 个任务的重试", [retryable.length]));
    } finally { setRetryAllBusy(false); }
  }

  function taskLabel(task: Task): string {
    if (task.kind === 'thumbnail') return t("缩略图");
    if (task.kind === 'scan') return t("目录扫描");
    return task.kind;
  }

  function taskStatusLabel(status: string): string {
    return ({ queued: t("等待中"), running: t("处理中"), paused: t("已暂停"), completed: t("已完成"), failed: t("失败"), cancelled: t("已取消") } as Record<string, string>)[status] ?? status;
  }

  const title = { library: t("图库"), albums: t("相册"), tags: t("标签"), settings: t("设置"), trash: t("回收站"), hidden: t("隐藏内容"), geo: t("足迹"), duplicates: t("重复检测") }[active];
  const currentAlbum = albums.find((album) => album.id === selectedAlbumId);
  const displayedAlbumMedia = selectedAlbumId ? albumMedia : [];
  const {type: _requestType,offset: _requestOffset,limit: _requestLimit,...playbackQuery}=mediaRequest();
  const playbackSource:PlaybackSource|undefined=active==='library' ? {...playbackQuery,scope:'library',query:playbackQuery.query ?? ''} as PlaybackSource : active==='hidden' ? {scope:'library',hiddenOnly:true,query:'',...hiddenSort} : active==='albums' && selectedAlbumId ? {scope:'album',id:selectedAlbumId,...albumSort} : active==='tags' && playbackTagId ? {scope:'tag',id:playbackTagId,...tagSort} : undefined;
  const previewItems = active === 'albums' && selectedAlbumId ? albumMedia : active === 'tags' ? tagMedia : ['trash','hidden','geo','duplicates'].includes(active) ? extraMedia : media;
  const idleLatest=useRef({active,preview,selected,items:previewItems});idleLatest.current={active,preview,selected,items:previewItems};
  useEffect(()=>{
    let checking=false;let disposed=false;
    const timer=window.setInterval(async()=>{
      const current=idleLatest.current;if(checking || current.preview || current.selected.size || !['library','albums','tags'].includes(current.active) || !current.items.length || document.querySelector('.tag-dialog'))return;
      checking=true;
      try{const settings=await window.lumina.command({type:'organization.settings'});if(!settings.idleSlideshowMinutes)return;const idle=await window.lumina.native({action:'idle-state'});const latest=idleLatest.current;if(!disposed && idle.focused && idle.seconds>=settings.idleSlideshowMinutes*60 && !latest.preview && !latest.selected.size && !document.querySelector('.tag-dialog') && latest.items.length){setIdlePlayback(true);setSlideshow(true);setPreview(latest.items[0]!);}}
      catch{ /* An unavailable idle API must never interrupt normal browsing. */ }
      finally{checking=false;}
    },15000);return()=>{disposed=true;window.clearInterval(timer);};
  },[]);
  useEffect(()=>{if(!preview)setIdlePlayback(false);},[preview]);
  const previewIndex = preview ? previewItems.findIndex((item) => item.id === preview.id) : -1;
  const keyboardLatest = useRef({ active, selected, previewItems }); keyboardLatest.current = { active, selected, previewItems };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,textarea,select') || document.querySelector('[role="dialog"],.tag-dialog')) return;
      const current = keyboardLatest.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); if (current.active === 'trash') void window.lumina.command({ type: 'trash.ids' }).then((ids: string[]) => setSelected(new Set(ids))); else setSelected(new Set(current.previewItems.map((item) => item.id)));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && current.selected.size) { event.preventDefault(); void window.lumina.native({ action: event.shiftKey ? 'copy-original' : 'copy', mediaIds: [...current.selected] }).then(() => setMessage(t("已复制；原文件可能保留 EXIF"))).catch((error) => setMessage(userErrorMessage(error))); }
      if (event.key === 'Delete' && current.selected.size) { event.preventDefault(); if (current.active === 'trash') setTrashPurgeIds([...current.selected]); else { setForcePermanent(event.shiftKey); setDeleteIds([...current.selected]); } }
    }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  function movePreview(step: number) {
    const next = previewItems[previewIndex + step];
    if (next) setPreview(next);
  }

  function openPreview(item: Media) {
    setSlideshow(false);
    setPreview(item);
  }

  function startSlideshow(item: Media) {
    setPreview(item);
    setSlideshow(true);
    setContextMenu(null);
  }


  function handleVideoKeyDown(event: React.KeyboardEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      video.currentTime = Math.max(0, Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + (event.key === 'ArrowLeft' ? -5 : 5)));
    } else if (event.key === ' ') {
      event.preventDefault();
      if (video.paused) void video.play(); else video.pause();
    }
  }

  async function finishDelete(results:{id:string;ok:boolean;error?:string}[],mode:string,background=false){ const success = new Set(results.filter((item) => item.ok).map((item) => item.id)); if(success.size){setUndoError('');setUndoTrashIds(mode==='software'?[...success]:[]);} const neighbors=preview && viewerWindow.some((item)=>item.id===preview.id) ? viewerWindow : previewItems;const currentIndex=preview ? neighbors.findIndex((item)=>item.id===preview.id) : -1;const next=neighbors.slice(currentIndex+1).find((item)=>!success.has(item.id)) ?? neighbors.slice(0,currentIndex).reverse().find((item)=>!success.has(item.id));if(success.size)setPlaybackRevision((value)=>value+1); if (preview && success.has(preview.id)) setPreview(next ?? null); if(!background)clearSelection();setMedia(current=>current.filter(item=>!success.has(item.id)));timelineWindows.current.clear();setOrganizationRevision((value) => value + 1); const failed = results.filter((item) => !item.ok); setMessage(failed.length ? t("成功 {0} 项；{1}", [success.size, failed.map((item) => userErrorMessage(item.error)).join('；')]) : t("已处理 {0} 项", [success.size])); }
  const finishDeleteLatest=useRef(finishDelete);finishDeleteLatest.current=finishDelete;
  useEffect(()=>{if(!pendingDeletes.length)return;let disposed=false;let timer:number|undefined;const poll=async()=>{for(const task of pendingDeletes){try{const job=await window.lumina.command({type:'jobs.result',id:task.id,limit:1000});if(disposed)return;if(['completed','failed','cancelled'].includes(job.status) && !job.active){const items=[...job.items];while(items.length<job.total){const next=await window.lumina.command({type:'jobs.result',id:task.id,limit:1000,offset:items.length});if(!next.items.length)break;items.push(...next.items);}await finishDeleteLatest.current(items.map((row:any)=>({id:row.id,ok:row.status==='completed',error:row.error??(row.status==='pending'?t("已取消，未执行"):undefined)})),task.mode,true);if(!disposed)setPendingDeletes((current)=>current.filter((row)=>row.id!==task.id));}}catch(error){if(!disposed)setMessage(userErrorMessage(error));}}if(!disposed)timer=window.setTimeout(poll,700);};void poll();return()=>{disposed=true;window.clearTimeout(timer);};},[pendingDeletes]);
  return <div className={expiryRunning ? 'shell expiry-running' : 'shell'}>
    {expiryRunning && <div className="expiry-status" role="status">{t("正在按入站策略处理到期项目…")}</div>}
    {taskDrawerOpen&&<TaskDrawer tasks={tasks} onRefresh={refreshTasks} onRetryThumbnail={retryTask} onClose={()=>setTaskDrawerOpen(false)}/>}
    <header className="app-header"><div className="app-brand"><img className="brand-mark" src="./lumina-album-icon-256.png" alt=""/><strong>{t("光匣")}</strong>{language==='zh-CN'&&<small>Lumina</small>}</div><div className="header-tools"><ActionButton title={t("局域网状态")}>◎</ActionButton><ActionButton title={t("主题")}>◐</ActionButton><ActionButton className="task-entry" title={t("任务状态")} aria-label={t("任务状态{0}", [activeTaskCount?t(" · {0} 项进行中", [activeTaskCount]):''])} onClick={()=>setTaskDrawerOpen(true)}>◷{activeTaskCount>0 && <span>{activeTaskCount}</span>}</ActionButton><ActionButton className="account-tool" title={t("管理员")}>{t("管")}</ActionButton></div></header>
    <div className="app-body"><aside className="sidebar"><nav>
      <ActionButton className={active === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('library')}><span>⌂</span>{t("图库")}</ActionButton>
      <ActionButton className={active === 'albums' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('albums')}><span>▦</span>{t("相册")}</ActionButton>
      <ActionButton className={active === 'tags' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('tags')}><span>◇</span>{t("标签")}</ActionButton>
      <ActionButton className={active === 'geo' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('geo')}><span>⌖</span>{t("足迹")}</ActionButton>
      <ActionButton className={active === 'trash' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('trash')}><span>↶</span>{t("回收站")}</ActionButton>
      <ActionButton className={active === 'duplicates' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('duplicates')}><span>▧</span>{t("重复检测")}</ActionButton>
      <span className="nav-group-label settings-label">{t("设置")}</span>
      <ActionButton className={active === 'settings' && settingsSection === 'general' ? 'nav-item active' : 'nav-item'} onClick={() => { setActive('settings'); setSettingsSection('general'); }}><span>◐</span>{t("常规")}</ActionButton>
      <ActionButton className={active === 'settings' && settingsSection === 'theme' ? 'nav-item active' : 'nav-item'} onClick={() => { setActive('settings'); setSettingsSection('theme'); }}><span>◉</span>{t("主题")}</ActionButton>
      <ActionButton className={active === 'settings' && settingsSection === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => { setActive('settings'); setSettingsSection('account'); }}><span>◎</span>{t("账号管理")}</ActionButton>
      <ActionButton className={active === 'settings' && settingsSection === 'about' ? 'nav-item active' : 'nav-item'} onClick={() => { setActive('settings'); setSettingsSection('about'); }}><span>i</span>{t("关于")}</ActionButton>
    </nav><div className="sidebar-bottom"><ActionButton className={active === 'hidden' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('hidden')}><span>⌂</span>{t("隐藏内容")}</ActionButton><div className="storage-card"><strong>{t("图库存储")}</strong><span>{formatBytes(mediaStats.totalSizeBytes)} · {mediaStats.total}{t("项")}</span><span>{t("照片")}{formatBytes(mediaStats.photoSizeBytes ?? 0)}{t("· 视频")}{formatBytes(mediaStats.videoSizeBytes ?? 0)}</span></div></div></aside>
    <main className={active==='library'?'main main-library':'main'}>{visitedPages.has('library') && <MediaActivity.Provider value={active==='library'}><section ref={homeWheel} hidden={active!=='library'} className="content library-content" onClick={handleLibraryBlankClick}>
       <div className="section-head library-heading"><div><h2>{t("图库")}</h2><p className="page-summary">{viewStats.total}{t("项 · 照片")}{viewStats.photo}{t("· 视频")}{viewStats.video}</p></div><div className="section-actions"><ActionButton className="ghost import-entry" title={t("选择文件导入，也可Ctrl+V粘贴或拖入文件夹")} onClick={()=>requestImport('files')}>{t("＋ 导入")}</ActionButton><div className="filter-group"><ActionButton className={mediaFilter === 'all' ? 'active' : ''} onClick={() => setMediaFilter('all')}>{t("全部")}</ActionButton><ActionButton className={mediaFilter === 'photo' ? 'active' : ''} onClick={() => setMediaFilter('photo')}>{t("照片")}</ActionButton><ActionButton className={mediaFilter === 'video' ? 'active' : ''} onClick={() => setMediaFilter('video')}>{t("视频")}</ActionButton></div></div></div>
       <div ref={searchBuilderRef} className="search-builder" onClick={() => setSearchMenuOpen(true)}><span className="search-icon">⌕</span>{searchChips.map((chip) => <SearchChip key={chip.id} label={chip.untagged?t("标签：{0}", [chip.type==='tag'?t("无"):t("有")]):`${chip.type === 'file' ? t("文件名包含") : chip.type === 'excludeFile' ? t("文件名不包含") : chip.type === 'extension' ? t("文件格式") : chip.type === 'tag' ? t("标签包含") : t("标签排除")}：${chip.value}`} value={chip.value} onRemove={()=>removeSearchChip(chip.id)}/>)}<span className="search-input-wrap">{searchModeSelected && <span className="search-prefix">{searchMode === 'file' ? t("文件名包含") : searchMode === 'excludeFile' ? t("文件名不包含") : searchMode === 'extension' ? t("文件格式") : searchMode === 'tag' ? t("标签包含") : t("标签排除")}：</span>}<input ref={searchInputRef} value={searchInput} title={searchInput||undefined} onFocus={handleSearchFocus} onChange={(event) => { const value = event.target.value; setSearchInput(value); setSearchMenuOpen(true); setTagSuggestionIndex(0); if (!searchModeSelected) setQuery(value); }} onKeyDown={handleSearchKeyDown} placeholder={searchModeSelected ? t("输入后按回车") : t("搜索照片、视频或标签…")} />{!searchModeSelected && searchMenuOpen && <SearchTypeMenu state={searchTypes}/>}{searchMenuOpen && searchModeSelected && searchOptions().length > 0 && <div className="search-tag-suggestions" role="listbox" aria-label={searchMode==='file'||searchMode==='excludeFile'?t("文件名建议"):searchMode==='extension'?t("文件格式建议"):t("标签建议")} onClick={(event) => event.stopPropagation()}>{searchOptions().map((option,index)=><ActionButton className={index===tagSuggestionIndex?'active':''} role="option" aria-selected={index===tagSuggestionIndex} key={option.untagged?'__untagged__':option.name} title={option.untagged?t("没有任何标签的媒体"):option.label} onClick={()=>selectSearchSuggestion(option.name,option.untagged)}>{option.label}</ActionButton>)}</div>}</span></div>
       <div className="home-view-toolbar"><label className="thumbnail-size">{t("缩略图")}<input aria-label={t("缩略图大小")} type="range" min="105" max="320" step="1" value={homeView==='list'?105:thumbnailSize} onChange={(event)=>{const value=Number(event.target.value);if(value<110)setHomeView('list');else{if(homeView==='list')setHomeView(homeGridView);setThumbnailSize(Math.max(110,value));}}}/></label><div className="page-actions"><select className="view-select" aria-label={t("视图切换")} value={homeView} onChange={(event)=>chooseHomeView(event.target.value as typeof homeView)}><option value="immersive">{t("默认视图")}</option><option value="time">{t("时间视图")}</option><option value="masonry">{t("瀑布视图")}</option><option value="list">{t("列表")}</option></select><div ref={sortControlRef} className="sort-control"><ActionButton className="ghost sort-label" onClick={() => setSortMenuOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={sortMenuOpen}>{t(sortLabels[sortBy])}</ActionButton><ActionButton className="ghost sort-direction" onClick={() => setSortDirection((current) => current === 'desc' ? 'asc' : 'desc')} title={sortDirection === 'desc' ? t("当前倒序，点击切换为正序") : t("当前正序，点击切换为倒序")} aria-label={sortDirection === 'desc' ? t("倒序，点击切换为正序") : t("正序，点击切换为倒序")}>{sortDirection === 'desc' ? '↓' : '↑'}</ActionButton>{sortMenuOpen && <div className="sort-menu" role="listbox">{(Object.keys(sortLabels) as SortBy[]).map((option) => <ActionButton key={option} className={sortBy === option ? 'active' : ''} role="option" aria-selected={sortBy === option} onClick={() => { setSortBy(option); setSortMenuOpen(false); }}>{t(sortLabels[option])}</ActionButton>)}</div>}</div></div></div>
       <div className="library-browser">{timeSeeking||timeSeekError?<div className="timeline-position-state" role="status" aria-live="polite" aria-busy={timeSeeking} style={{'--preview-card-size':`${thumbnailSize}px`} as React.CSSProperties}><h3>{timeAnchor?timeAnchor.replace('-',t("年"))+t("月"):t("图库起点")}</h3>{timeSeekError?<><p>{timeSeekError}</p><ActionButton className="ghost" onClick={()=>timeAnchor?jumpMonth(timeAnchor):jumpMonthReset()}>{t("重试")}</ActionButton></>:<><p>{t("正在加载该位置的媒体…")}</p><div className="timeline-position-skeleton" aria-hidden="true">{Array.from({length:24},(_,index)=><span key={index}/>)}</div></>}</div>:media.length === 0 ? <div className="empty"><div className="empty-icon">▧</div><h3>{query.trim() || searchChips.length ? t("没有匹配媒体") : t("还没有媒体")}</h3><p>{query.trim() || searchChips.length ? t("尝试更换文件名或标签。") : t("添加一个本地目录开始建立图库。")}</p>{!query.trim() && searchChips.length === 0 && <ActionButton className="primary" onClick={() => addFolder()}>{t("添加图库目录")}</ActionButton>}</div> : <GroupedMediaGrid selectionSource={{...mediaRequest(),scope:'library',query:mediaRequest().query??''}} tagRevision={organizationRevision} monthCounts={Object.fromEntries(timelineMonths.map(row=>[`${row.month.slice(0,4)}年${Number(row.month.slice(5))}月`,row.count]))} windowKey={mediaWindow.current.key} startOffset={mediaStart} onStartReached={()=>void loadPreviousMedia()} items={media} thumbnails={thumbnails} selected={selected} onToggle={toggleSelected} onOpen={openPreview} onContextMenu={openContextMenu} onVisible={handleVisibleMedia} onEndReached={() => void loadMoreMedia()} onSelectMany={setSelected} editMode={editMode} view={homeView} cardSize={thumbnailSize} hasMore={canLoadMore} loadingMore={loadingMore} groupByMonth={homeView==='time' && (sortBy === 'fileTime' || sortBy === 'capturedAt')} capturedTime={sortBy === 'capturedAt'} />}{(sortBy==='fileTime' || sortBy==='capturedAt') && <LibraryTimeAxis months={timelineMonths} anchor={timeAnchor} onJump={jumpMonth} onReset={()=>jumpMonthReset()}/>}</div><div className="batch-bar selection-bar"><div className="selection-context"><div><span className="edit-mode-control"><span>{t("编辑模式")}</span><ToggleSwitch checked={editMode} onChange={()=>setEditMode(value=>!value)} label={t("编辑模式")}/></span><span className="selection-count">{selected.size ? t("已选择 {0} 项", [selected.size]) : t("未选择媒体")}</span><span className="edit-mode-help"><ActionButton className="edit-mode-info" aria-label={t("编辑模式说明")} aria-describedby="edit-mode-tip">?</ActionButton><span id="edit-mode-tip" role="tooltip">{t("关闭：点击空白处清空选择项。")}<br/>{t("开启：点击空白处不清空选择项，多选操作反选项目，编辑操作成功后清空选择项")}</span></span></div><small>{editMode?t("拖动空白处框选 · 框选 / Shift 多选可反选"):t("拖动空白处框选 · Ctrl / Shift 多选")}</small></div><ActionButton className="ghost" disabled={!selected.size} onClick={() => addSelectedToNamedAlbum()}>{t("加入相册")}</ActionButton><ActionButton className="primary" disabled={!selected.size} onClick={() => openTagDialog()}>{t("编辑标签")}</ActionButton><ActionButton className="ghost" disabled={!selected.size} onClick={() => setExporting({ mediaIds: [...selected] })}>{t("导出")}</ActionButton><ActionButton className="ghost" disabled={!selected.size} onClick={() => hideSelectedMedia()}>{t("隐藏")}</ActionButton><ActionButton className="ghost" disabled={!selected.size} onClick={() => deleteSelectedMedia()}>{t("删除")}</ActionButton></div></section></MediaActivity.Provider>}
      {visitedPages.has('albums') && <div className="page-host" hidden={active!=='albums'}><MediaActivity.Provider value={active==='albums'}><AlbumsPage onSortChange={setAlbumSort} onSelectMany={setSelected} onClear={clearSelection} onLoadMoreReady={registerAlbumMore} albums={albums} tags={tags} thumbnails={thumbnails} selected={selected} onToggle={toggleSelected} onOpen={openPreview} onVisible={handleVisibleMedia} onContextMenu={openContextMenu} onChanged={refreshTagChanges} onMediaChange={setAlbumMedia} onAlbumChange={handleAlbumChange} onExportAlbum={(id) => setExporting({ albumId: id })} /></MediaActivity.Provider></div>}
      {visitedPages.has('tags') && <div className="page-host" hidden={active!=='tags'}><MediaActivity.Provider value={active==='tags'}><TagsPage onSortChange={setTagSort} onSelectMany={setSelected} onClear={clearSelection} onTagChange={setPlaybackTagId} onLoadMoreReady={registerTagMore} tags={tags} thumbnails={thumbnails} selected={selected} onChanged={refreshTagChanges} onMediaChange={setTagMedia} onSelect={toggleSelected} onOpen={openPreview} onVisible={handleVisibleMedia} onContextMenu={openContextMenu} /></MediaActivity.Provider></div>}
      {albumEditor && <LibraryFormDialog key={albumEditor === 'create' ? 'new' : albumEditor.id} title={albumEditor === 'create' ? t("新建相册") : t("编辑相册")} initialName={albumEditor === 'create' ? '' : albumEditor.name} initialDescription={albumEditor === 'create' ? '' : albumEditor.description} nameLabel={t("相册名称")} maxLength={200} onClose={() => setAlbumEditor(null)} onSave={async (name, description) => {
        if (albumEditor === 'create') await window.lumina.command({ type: 'albums.create', name, description });
        else await window.lumina.command({ type: 'albums.update', id: albumEditor.id, name, description });
        await refresh(); setMessage(albumEditor === 'create' ? t("相册已创建") : t("相册已更新"));
      }} />}
      {albumPickerMediaIds && <AlbumPickerDialog albums={albums.filter((album) => album.kind !== 'smart' && album.kind!=='folder')} mediaCount={albumPickerMediaIds.length} onClose={() => setAlbumPickerMediaIds(null)} onSave={async (ids) => {
        for (const id of ids) for(let offset=0;offset<albumPickerMediaIds.length;offset+=1000) await window.lumina.command({ type: 'albums.addMedia', id, mediaIds: albumPickerMediaIds.slice(offset,offset+1000) });
        await refreshTagChanges();
        clearSelection(); setMessage(t("已加入 {0} 个相册", [ids.length]));
      }} />}
      {albumDeleting && <LibraryConfirmDialog title={t("删除相册")} description={t("删除相册「{0}」？仅移除相册和媒体引用，保留原文件。", [albumDeleting.name])} onClose={() => setAlbumDeleting(null)} onConfirm={async () => {
        await window.lumina.command({ type: 'albums.delete', id: albumDeleting.id });
        if (selectedAlbumId === albumDeleting.id) { setSelectedAlbumId(null); setAlbumMedia([]); }
        await refresh(); setMessage(t("相册已删除"));
      }} />}
      {active === 'settings' && <section className="content"><div className="section-head"><div><h2>{settingsSection === 'general' ? t("设置 · 常规") : settingsSection === 'theme' ? t("设置 · 主题") : settingsSection === 'account' ? t("设置 · 账号管理") : t("设置 · 关于")}</h2><p>{settingsSection === 'general' ? t("管理图库目录、索引状态和本地任务。") : settingsSection === 'theme' ? t("管理内置主题与自定义主题。") : settingsSection === 'account' ? t("本机账号功能将在后续版本接入。") : t("光匣 Lumina 本地照片与视频管理器。")}</p></div></div>{settingsSection === 'general' ? <div className="general-settings-stack"><LanguageSettings/><DirectorySettings roots={roots} mediaCount={mediaStats.total} albumCount={albums.length} busy={busy} taskBusyId={taskBusyId} onAdd={addFolder} onSetup={root=>setDirectorySetup({absolutePath:root.absolutePath,root})} onTags={root=>openTagDialog(root)} onScan={rescanRoot} onToggle={setRootEnabled} onRemove={removeRoot}/><ImportSettings/><CacheSettings/><OrganizationSettings onChanged={refreshTagChanges} /><TaskManager tasks={tasks} onRefresh={refreshTasks} onRetryThumbnail={retryTask} /></div> : <div className="settings-card"><div><strong>{settingsSection === 'theme' ? 'Lumina Light' : settingsSection === 'account' ? t("本机管理员") : t("光匣 Lumina")}</strong><p>{settingsSection === 'theme' ? t("当前主题 · 蓝白基础主题") : settingsSection === 'account' ? t("本地数据由当前 Windows 用户管理。") : t("开发阶段 M2 · 本地整理")}</p></div>{settingsSection === 'theme' && <ActionButton className="ghost" onClick={() => setMessage(t("自定义主题将在后续版本接入"))}>{t("管理主题")}</ActionButton>}</div>}</section>}
      <ImportController/>{directorySetup && <DirectorySetupDialog {...directorySetup} tags={tags} onClose={()=>setDirectorySetup(null)} onSaved={id=>{if(id){window.dispatchEvent(new CustomEvent('lumina-job-started',{detail:{id,kind:'directory-rules',began:Date.now()}}));setJobId(id);}void refresh();setMessage(id?(directorySetup.root?t("目录规则已保存，正在后台应用于已索引媒体"):t("目录已添加，正在后台扫描并应用规则")):t("目录设置已保存"));}}/>}
      {hiddenReason && <HiddenReasonDialog reason={hiddenReason} onClose={()=>setHiddenReason(null)} onShow={()=>applyVisibility(hiddenReason.ids,false,hiddenReason.byMedia)} onEdit={()=>{const ids=hiddenReason.ids;setHiddenReason(null);void openTagDialog(undefined,ids);}}/>}
      {tagDialogMode && <div className="dialog-backdrop" onClick={closeTagDialog}><section ref={tagDialogRef} className="tag-dialog" role="dialog" aria-modal="true" aria-label={t("编辑标签")} onClick={(event) => event.stopPropagation()}><div className="dialog-head"><div><strong>{t("编辑标签")}</strong><p>{t("已选择")}{tagTargetIds.length}{t("项媒体")}</p>{tagRoot && <p className="dialog-hint" title={tagRoot.absolutePath}>{t("目录：")}{tagRoot.label}{t("· 包含子目录和隐藏/停用项目，不含回收站")}</p>}</div><ActionButton className="icon-button" disabled={busy} onClick={closeTagDialog}>×</ActionButton></div><div className="tag-dialog-section"><label>{t("当前标签")}</label>{tagDialogLoading ? <p className="dialog-hint">{t("正在读取标签…")}</p> : tagDialogTags.length === 0 ? <p className="dialog-hint">{t("选中媒体暂无标签")}</p> : <div className="dialog-tag-list">{tagDialogTags.map((tag) => <span className={tag.count === tagTargetIds.length ? 'dialog-tag common' : 'dialog-tag partial'} key={tag.name}>#{tagLabel(tag)}{tagTargetIds.length > 1 && <small>{tag.count}/{tagTargetIds.length}</small>}{<ActionButton disabled={tag.count !== tagTargetIds.length || busy || Boolean(pendingTagJob)} title={tag.count === tagTargetIds.length ? t("移除所有选中媒体的该标签") : t("只有所有选中媒体共有的标签才能移除")} onClick={() => removeTagFromDialog(tag.name)}>×</ActionButton>}</span>)}</div>}</div>{<div className="dialog-form"><TagAutocomplete value={tagDialogName} onChange={setTagDialogName} onCommit={(value)=>void addTagFromDialog(value)} suggestions={matchingTags(tagDialogName,true)} allTags={orderedTags().filter(tag=>!tag.directory)} onCreateChild={setTagChildParent} disabled={busy || Boolean(pendingTagJob)}/><label className="tag-continuous"><input type="checkbox" checked={continuousTags} onChange={(event)=>setContinuousTags(event.target.checked)}/>{t("连续添加")}</label><ActionButton className="primary" disabled={busy || Boolean(pendingTagJob) || !tagDialogName.trim()} onClick={() => addTagFromDialog()}>{t("添加")}</ActionButton></div>}{tagTargetIds.length>1 && <p className="dialog-hint tag-editor-selection-hint">{t("只有所有选中媒体都拥有的共同标签可以移除。")}</p>}<div className="dialog-footer tag-editor-footer"><ActionButton className="ghost" disabled={busy} onClick={closeTagDialog}>{t("完成")}</ActionButton></div></section></div>}
{preview && <MediaViewer onMediaAction={viewerMediaAction} item={preview} items={previewItems} source={playbackSource} revision={playbackRevision} onWindowChange={setViewerWindow} slideshow={slideshow} idle={idlePlayback} onChange={setPreview} onClose={() => { setPreview(null); setSlideshow(false); }} onDelete={(id,permanent=false) => { if (active === 'trash') setTrashPurgeIds([id]); else {setForcePermanent(permanent);setDeleteIds([id]);} }} onExport={(ids) => setExporting({ mediaIds: ids })} onNearEnd={() => { if (active === 'library') void loadMoreMedia(); else if(active==='albums')albumMoreRef.current();else if(active==='tags')tagMoreRef.current(); }} />}
      {detailMedia && <MediaDetailsDialog item={detailMedia} onClose={() => setDetailMedia(null)} />}
      {contextMenu && <div ref={contextMenuRef} className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}><ActionButton onClick={() => { openPreview(contextMenu.item); setContextMenu(null); }}>{t("打开")}</ActionButton><ActionButton onClick={() => copyContextMedia()}>{t("复制")}{contextMenu.item.kind === 'video' ? t("文件") : t("图片")}</ActionButton><ActionButton onClick={() => startSlideshow(contextMenu.item)}>{t("幻灯片")}</ActionButton><ActionButton onClick={() => addContextMediaToAlbum()}>{t("加入相册…")}</ActionButton>{active==='albums' && m2Album?.kind!=='folder' && m2Album && <ActionButton onClick={()=>setCover(contextMenu.item.id)}>{t("设置为封面")}</ActionButton>}<ActionButton onClick={() => updateContextTag('add')}>{t("编辑标签…")}</ActionButton><ActionButton onClick={() => hideContextMedia()}>{active==='hidden'?t("取消隐藏"):t("隐藏")}</ActionButton><ActionButton onClick={exportContextMedia}>{t("导出")}{contextMenu.item.kind === 'video' ? t("视频") : t("原图")}…</ActionButton><ActionButton onClick={() => openDetails(contextMenu.item)}>{t("详情")}</ActionButton><ActionButton onClick={async ()=>{await window.lumina.native({action:'show-file',mediaIds:[contextMenu.item.id]}).catch(error=>setMessage(userErrorMessage(error)));setContextMenu(null);}}>{t("在资源管理器中打开")}</ActionButton><ActionButton className="danger" onClick={() => removeContextMedia()}>{t("删除")}</ActionButton></div>}
      {visitedPages.has('hidden') && <div className="page-host" hidden={active!=='hidden'}><MediaActivity.Provider value={active==='hidden'}><HiddenMediaPage active={active==='hidden'} revision={organizationRevision} editMode={editMode} tags={tags} onClear={clearSelection} onSelectMany={setSelected} onScopeChange={setHiddenSort} onMediaChange={extraHandlers.hidden!} thumbnails={thumbnails} selected={selected} onToggle={toggleSelected} onOpen={openPreview} onVisible={handleVisibleMedia} onContextMenu={openContextMenu}/></MediaActivity.Provider></div>}
      {(['trash','geo','duplicates'] as const).filter((page)=>visitedPages.has(page)).map((page)=><div key={page} className="page-host" hidden={active!==page}><MediaActivity.Provider value={active===page}><OrganizationPage onSelectMany={setSelected} active={active===page} page={page} revision={organizationRevision} thumbnails={thumbnails} selected={selected} onToggle={toggleSelected} onOpen={openPreview} onVisible={handleVisibleMedia} onContextMenu={openContextMenu} onMediaChange={extraHandlers[page]!} onChanged={refreshTagChanges} onClear={clearSelection} /></MediaActivity.Provider></div>)}
      {(active==='hidden' || active==='albums' && m2Album && m2Album.kind!=='folder' || ['tags','geo'].includes(active) && selected.size>0) && <div className="organization-footer">{active==='hidden' && <label className="edit-mode-control">{t("编辑模式")}<ToggleSwitch checked={editMode} onChange={()=>setEditMode(value=>!value)} label={t("编辑模式")}/></label>}<span>{selected.size?t("已选择 {0} 项", [selected.size]):t("未选择媒体")}</span>{active==='albums' && m2Album && <ActionButton className="ghost" disabled={!selected.size} onClick={removeAlbumSelection}>{m2Album.kind==='smart'?t("加入排除项"):t("从此相册移出")}</ActionButton>}<ActionButton className="ghost" disabled={!selected.size} onClick={() => addSelectedToNamedAlbum()}>{t("加入相册")}</ActionButton><ActionButton className="primary" disabled={!selected.size} onClick={() => openTagDialog()}>{t("编辑标签")}</ActionButton><ActionButton className="ghost" disabled={!selected.size} onClick={() => setExporting({ mediaIds: [...selected] })}>{t("导出")}</ActionButton>{active==='hidden' && <ActionButton className="ghost" disabled={!selected.size} onClick={()=>hideSelectedMedia()}>{t("取消隐藏")}</ActionButton>}<ActionButton className="ghost" disabled={!selected.size} onClick={() => deleteSelectedMedia()}>{t("删除")}</ActionButton></div>}
      {deleteIds && <DeleteDialog ids={deleteIds} forcePermanent={forcePermanent} onClose={() => { setDeleteIds(null); setForcePermanent(false); }} onDone={finishDelete} onJobStarted={(id,mode)=>{setJobId(id);setPendingDeletes((current)=>[...current,{id,mode}]);clearSelection();}} />}
      {trashPurgeIds && <LibraryConfirmDialog title={t("永久删除")} description={t("永久删除 {0} 项文件？这会从磁盘彻底删除，无法还原。", [trashPurgeIds.length])} onClose={() => setTrashPurgeIds(null)} onConfirm={async () => { if(trashPurgeIds.length>1){const job=await startBackgroundJob({type:'jobs.start',kind:'purge',mediaIds:trashPurgeIds});setJobId(job.id);setPreview(null);return;}const results = await window.lumina.command({ type: 'trash.purge', mediaIds: trashPurgeIds, destination: 'permanent' }); const failed = results.filter((item: any) => !item.ok); if (failed.length) throw new Error(failed.map((item: any) => item.error).join('；')); setPreview(null); await refreshTagChanges(); }} />}
      {tagBatchJob && <JobDialog id={tagBatchJob} onClose={() => {setTagBatchJob(null);void loadTagDialogTags();void refreshTagChanges();}} />}
      {exporting && <ExportDialog {...exporting} includeHidden={active==='hidden'} onStarted={clearSelection} onClose={() => setExporting(null)} />}
      {jobId && <JobDialog id={jobId} onClose={() => setJobId(null)} />}
      {albumUndo && <div className="toast undo-toast album-undo-toast" role="status"><span>{t("{0} {1} 项 · {2}", [albumUndo.smart?t("已排除"):t("已移出"), albumUndo.count, albumUndo.name])}</span><ActionButton className="ghost" disabled={albumUndoBusy} onClick={undoAlbumSelection}>{albumUndoBusy?t("正在撤销…"):t("撤销")}</ActionButton><ActionButton className="icon-button" disabled={albumUndoBusy} aria-label={t("关闭撤销提示")} onClick={()=>setAlbumUndo(null)}>×</ActionButton></div>}
      {undoTrashIds.length>0 ? <div className="toast undo-toast" role="status"><span>{undoError || t("{0} 项已移入软件回收站", [undoTrashIds.length])}</span><ActionButton className="ghost" disabled={undoBusy} onClick={()=>undoSoftwareDelete()}>{undoBusy?t("正在还原…"):t("撤销删除")}</ActionButton></div> : !albumUndo && message && <div className="toast" role="status">{translateMessage(message)}</div>}
      <BackgroundTaskNotice onOpen={setJobId}/>
      {tagChildParent && <TagEditor tag="create" tags={tags} parentId={tagChildParent.id} onClose={()=>setTagChildParent(null)} onSaved={refreshTagChanges}/>}
    </main></div>
  </div>;
}
