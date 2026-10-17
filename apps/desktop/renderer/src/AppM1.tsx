import { useEffect, useState } from 'react';

type Root = { id: string; absolutePath: string; label: string; enabled: boolean };
type Media = { id: string; absolutePath: string; kind: string; hidden: boolean };
type Album = { id: string; name: string; description: string; coverMode: 'auto' | 'manual'; manualCoverMediaId: string | null };
type Tag = { id: string; name: string };

function fileName(filePath: string): string { return filePath.split(/[\\/]/u).pop() ?? filePath; }

export function AppM1() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [albumMedia, setAlbumMedia] = useState<Media[]>([]);
  const [active, setActive] = useState<'library' | 'albums' | 'tags' | 'settings'>('library');
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [tagName, setTagName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    const [nextRoots, nextMedia, nextAlbums, nextTags] = await Promise.all([
      window.lumina.command({ type: 'roots.list' }),
      window.lumina.command({ type: query.trim() ? 'media.search' : 'media.list', ...(query.trim() ? { query: query.trim() } : {}), limit: 200 }),
      window.lumina.command({ type: 'albums.list' }),
      window.lumina.command({ type: 'tags.list' }),
    ]);
    setRoots(nextRoots as Root[]); setMedia(nextMedia as Media[]); setAlbums(nextAlbums as Album[]); setTags(nextTags as Tag[]);
  }

  async function refreshAlbum(albumId: string) {
    const result = await window.lumina.command({ type: 'albums.media', id: albumId, limit: 200 });
    setAlbumMedia(result as Media[]);
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [query]);

  async function addFolder() {
    const folder = await window.lumina.pickFolder(); if (!folder) return;
    setBusy(true); setMessage('正在扫描目录…');
    try { const result = await window.lumina.command({ type: 'roots.addAndScan', absolutePath: folder }) as { media?: Media[] }; await refresh(); setMessage(`扫描完成，发现 ${result.media?.length ?? 0} 项媒体`); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function toggleSelected(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function addTag() {
    const name = tagName.trim(); if (!name || selected.size === 0) return;
    setBusy(true); setMessage(`正在为 ${selected.size} 项添加标签…`);
    try { await Promise.all([...selected].map((id) => window.lumina.command({ type: 'media.addTag', id, tagName: name }))); setTagName(''); setSelected(new Set()); setMessage(`已添加标签「${name}」`); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function removeTag() {
    const name = tagName.trim(); if (!name || selected.size === 0) return;
    setBusy(true); setMessage(`正在从 ${selected.size} 项移除标签…`);
    try { await Promise.all([...selected].map((id) => window.lumina.command({ type: 'media.removeTag', id, tagName: name }))); setTagName(''); setSelected(new Set()); setMessage(`已移除标签「${name}」`); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function createAlbum() {
    const name = window.prompt('相册名称'); if (!name?.trim()) return;
    const description = window.prompt('相册描述（可选）') ?? '';
    await window.lumina.command({ type: 'albums.create', name: name.trim(), description }); await refresh(); setActive('albums'); setMessage('相册已创建');
  }

  async function editAlbum(album: Album) {
    const name = window.prompt('相册名称', album.name); if (!name?.trim()) return;
    const description = window.prompt('相册描述', album.description) ?? '';
    await window.lumina.command({ type: 'albums.update', id: album.id, name: name.trim(), description }); await refresh(); setMessage('相册已更新');
  }

  async function deleteAlbum(album: Album) {
    if (!window.confirm(`删除相册“${album.name}”？媒体文件不会被删除。`)) return;
    await window.lumina.command({ type: 'albums.delete', id: album.id });
    if (selectedAlbumId === album.id) { setSelectedAlbumId(null); setAlbumMedia([]); }
    await refresh(); setMessage('相册已删除');
  }

  async function addSelectedToAlbum() {
    if (!selectedAlbumId || selected.size === 0) return;
    await window.lumina.command({ type: 'albums.addMedia', id: selectedAlbumId, mediaIds: [...selected] }); await refreshAlbum(selectedAlbumId); setSelected(new Set()); setMessage('已加入相册');
  }

  async function removeSelectedFromAlbum() {
    if (!selectedAlbumId || selected.size === 0) return;
    await window.lumina.command({ type: 'albums.removeMedia', id: selectedAlbumId, mediaIds: [...selected] }); await refreshAlbum(selectedAlbumId); setSelected(new Set()); setMessage('已移出相册');
  }

  async function setCover(mediaId: string | null) {
    if (!selectedAlbumId) return;
    await window.lumina.command({ type: 'albums.setCover', id: selectedAlbumId, mediaId });
    await refresh(); setMessage(mediaId ? '封面已设置' : '已恢复默认封面');
  }

  async function setRootEnabled(root: Root) { await window.lumina.command({ type: 'roots.setEnabled', id: root.id, enabled: !root.enabled }); await refresh(); }
  async function removeRoot(root: Root) { if (!window.confirm(`移除目录“${root.label}”？已索引文件不会被删除。`)) return; await window.lumina.command({ type: 'roots.remove', id: root.id }); await refresh(); setMessage('目录已移除'); }

  const title = { library: '图库', albums: '相册', tags: '标签', settings: '设置' }[active];
  const currentAlbum = albums.find((album) => album.id === selectedAlbumId);
  const displayedAlbumMedia = selectedAlbumId ? albumMedia : [];

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">L</span><span>光匣</span><small>Lumina</small></div><nav>
      <button className={active === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('library')}><span>▦</span>图库</button>
      <button className={active === 'albums' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('albums')}><span>▱</span>相册</button>
      <button className={active === 'tags' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('tags')}><span>#</span>标签</button>
    </nav><div className="sidebar-bottom"><button className={active === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setActive('settings')}><span>⚙</span>设置</button></div></aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">本地媒体管理</p><h1>{title}</h1></div><div className="actions"><span className="status-dot" />{message || `${media.length} 项媒体`}<button className="primary" disabled={busy} onClick={() => void addFolder()}>＋ 添加目录</button></div></header>
      {active === 'library' && <section className="content"><div className="summary"><div><span>图库目录</span><strong>{roots.length}</strong></div><div><span>已索引媒体</span><strong>{media.length}</strong></div><div><span>相册</span><strong>{albums.length}</strong></div></div><div className="section-head"><div><h2>最近媒体</h2><p>按最近修改时间显示，预览能力将在 M2 接入。</p></div><div className="section-actions"><input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名或标签" /><button className="ghost" onClick={() => void refresh()}>刷新</button></div></div>
        {selected.size > 0 && <div className="batch-bar"><span>已选择 {selected.size} 项</span>{selectedAlbumId && <button className="ghost" onClick={() => void addSelectedToAlbum()}>加入当前相册</button>}<input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="输入标签" /><button className="primary" disabled={busy || !tagName.trim()} onClick={() => void addTag()}>批量添加标签</button><button className="ghost" disabled={busy || !tagName.trim()} onClick={() => void removeTag()}>批量移除标签</button><button className="ghost" onClick={() => setSelected(new Set())}>取消选择</button></div>}
        {media.length === 0 ? <div className="empty"><div className="empty-icon">▧</div><h3>{query ? '没有匹配媒体' : '还没有媒体'}</h3><p>{query ? '尝试更换文件名或标签。' : '添加一个本地目录开始建立图库。'}</p><button className="primary" onClick={() => void addFolder()}>添加图库目录</button></div> : <div className="media-grid">{media.map((item) => <article className={selected.has(item.id) ? 'media-card selected' : 'media-card'} key={item.id} onClick={() => toggleSelected(item.id)}><div className="media-placeholder"><span>{item.kind === 'video' ? '▶' : '✦'}</span><i>{selected.has(item.id) ? '✓' : ''}</i></div><div className="media-meta"><strong>{fileName(item.absolutePath)}</strong><small>{item.kind === 'video' ? '视频' : '照片'}</small></div></article>)}</div>}</section>}
      {active === 'albums' && <section className="content"><div className="section-head"><div><h2>{currentAlbum ? currentAlbum.name : '相册'}</h2><p>{currentAlbum ? currentAlbum.description || '暂无描述' : '管理媒体引用和相册描述。'}</p></div><div className="section-actions">{currentAlbum && <button className="ghost" onClick={() => { setSelectedAlbumId(null); setAlbumMedia([]); }}>返回相册</button>}<button className="primary" onClick={() => void createAlbum()}>＋ 新建相册</button></div></div>{currentAlbum ? <><div className="album-toolbar"><button className="ghost" onClick={() => void editAlbum(currentAlbum)}>编辑相册</button><button className="ghost" onClick={() => void deleteAlbum(currentAlbum)}>删除相册</button><button className="ghost" onClick={() => setActive('library')}>去图库选择媒体</button>{selected.size === 1 && <button className="ghost" onClick={() => void setCover([...selected][0]!)}>设为封面</button>}<button className="ghost" onClick={() => void setCover(null)}>恢复默认封面</button>{selected.size > 0 && <button className="ghost" onClick={() => void removeSelectedFromAlbum()}>移出已选媒体</button>}</div><div className="media-grid">{displayedAlbumMedia.map((item) => <article className={selected.has(item.id) ? 'media-card selected' : 'media-card'} key={item.id} onClick={() => toggleSelected(item.id)}><div className="media-placeholder"><span>{item.kind === 'video' ? '▶' : '✦'}</span><i>{selected.has(item.id) ? '✓' : ''}</i></div><div className="media-meta"><strong>{fileName(item.absolutePath)}</strong><small>{item.kind === 'video' ? '视频' : '照片'}</small></div></article>)}</div></> : <div className="list-grid">{albums.map((album) => <article className="list-card clickable" key={album.id} onClick={() => { setSelectedAlbumId(album.id); void refreshAlbum(album.id); }}><div className="list-icon">▱</div><div><strong>{album.name}</strong><p>{album.description || '暂无描述'}</p></div><button className="icon-button" onClick={(event) => { event.stopPropagation(); void editAlbum(album); }}>···</button></article>)}</div>}</section>}
      {active === 'tags' && <section className="content"><div className="section-head"><div><h2>标签</h2><p>在图库中选择媒体后，可以批量添加或移除标签。</p></div><button className="ghost" onClick={() => setActive('library')}>返回图库</button></div>{tags.length === 0 ? <div className="empty compact"><div className="empty-icon">#</div><h3>还没有标签</h3><p>在图库中选择媒体并添加标签。</p></div> : <div className="tag-list">{tags.map((tag) => <span className="tag-chip" key={tag.id}>#{tag.name}</span>)}</div>}</section>}
      {active === 'settings' && <section className="content"><div className="section-head"><div><h2>设置</h2><p>管理图库目录。目录移除不会删除原文件。</p></div><button className="primary" onClick={() => void addFolder()}>＋ 添加目录</button></div><div className="root-list">{roots.length === 0 ? <div className="empty compact"><h3>尚未添加目录</h3><p>添加本地目录后，Lumina 会建立索引。</p></div> : roots.map((root) => <div className="root-row" key={root.id}><div><strong>{root.label}</strong><p>{root.absolutePath}</p></div><div className="row-actions"><button className="ghost" onClick={() => void setRootEnabled(root)}>{root.enabled ? '停用' : '启用'}</button><button className="ghost" onClick={() => void removeRoot(root)}>移除</button></div></div>)}</div></section>}
    </main>
  </div>;
}
