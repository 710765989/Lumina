import Database from 'better-sqlite3';
import path from 'node:path';
import { matchesSearch } from '@lumina/contracts';
import {initializeVisibility} from './visibility.js';
import {migrateDirectoryTagTypes} from './directory-tag-migration.js';

export const schemaVersion = 11;

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  absolute_path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  modified_at_ms INTEGER NOT NULL,
  captured_at_ms INTEGER,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_media_added ON media(created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_media_size ON media(size_bytes DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_media_name ON media(absolute_path COLLATE NOCASE, id ASC);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_mode TEXT NOT NULL DEFAULT 'auto',
  manual_cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS album_media (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, media_id)
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_tags (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS library_roots (
  id TEXT PRIMARY KEY,
  absolute_path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_library_roots_enabled ON library_roots(enabled, label);
CREATE TABLE IF NOT EXISTS hidden_media (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hidden_media_at ON hidden_media(hidden_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  media_id UNINDEXED,
  searchable,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export type LuminaDatabase = Database.Database;

export function openDatabase(filename: string): LuminaDatabase {
  const db = new Database(filename);
  db.function('lumina_matches',{deterministic:true},(text,query)=>matchesSearch(String(text??''),String(query??''))?1:0);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  const previousVersion=(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {version:number|null}).version;
  if (filename !== ':memory:' && previousVersion !== null && previousVersion < schemaVersion) {
    // SQLite copies the live database, including WAL, into a consistent backup.
    db.prepare('VACUUM INTO ?').run(`${filename}.pre-m2-${Date.now()}.db`);
  }
  const mediaColumns = db.prepare('PRAGMA table_info(media)').all() as Array<{ name: string }>;
  if(!(db.prepare('PRAGMA table_info(tags)').all() as {name:string}[]).some((column)=>column.name==='parent_id'))db.exec('ALTER TABLE tags ADD COLUMN parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS tag_edges (
    parent_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(parent_id,child_id),CHECK(parent_id<>child_id)
  );CREATE INDEX IF NOT EXISTS idx_tag_edges_child ON tag_edges(child_id,parent_id);`);
  if((previousVersion??0)<7)db.transaction(()=>{
    db.exec('INSERT OR IGNORE INTO tag_edges(parent_id,child_id) SELECT parent_id,id FROM tags WHERE parent_id IS NOT NULL;UPDATE tags SET parent_id=NULL');
  })();
  if(!(db.prepare('PRAGMA table_info(tags)').all() as {name:string}[]).some(column=>column.name==='english_name'))db.exec("ALTER TABLE tags ADD COLUMN english_name TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE tags SET english_name=name WHERE english_name='' AND name NOT GLOB '*[一-龥]*'");
  if (!mediaColumns.some((column) => column.name === 'captured_at_ms')) db.exec('ALTER TABLE media ADD COLUMN captured_at_ms INTEGER');
  if (!mediaColumns.some((column) => column.name === 'file_name')) {
    db.exec("ALTER TABLE media ADD COLUMN file_name TEXT NOT NULL DEFAULT ''");
    db.transaction(() => { const update = db.prepare('UPDATE media SET file_name=? WHERE id=?'); for (const row of db.prepare('SELECT id,absolute_path FROM media').all() as { id: string; absolute_path: string }[]) update.run(path.win32.basename(row.absolute_path.replaceAll('/', '\\')),row.id); })();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_modified ON media(modified_at_ms DESC, id ASC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_captured ON media(captured_at_ms DESC, modified_at_ms DESC, id ASC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_effective_capture ON media(COALESCE(captured_at_ms,modified_at_ms) DESC,id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags(tag_id,media_id)');
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_file_name ON media(COALESCE(NULLIF(file_name,''),absolute_path) COLLATE NOCASE,id)");
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  if (!taskColumns.some((column) => column.name === 'payload_json')) db.exec('ALTER TABLE tasks ADD COLUMN payload_json TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_albums (
      album_id TEXT PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
      rule_json TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS album_tags (
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(album_id,tag_id)
    );
    CREATE TABLE IF NOT EXISTS tag_options (
      tag_id TEXT PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
      color TEXT NOT NULL DEFAULT '#2b73df', group_name TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]', blocked INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS media_details (
      media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
      metadata_json TEXT NOT NULL DEFAULT '{}', content_hash TEXT, hash_fingerprint TEXT,
      missing INTEGER NOT NULL DEFAULT 0, file_identity TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_media_content_hash ON media_details(content_hash);
    CREATE TABLE IF NOT EXISTS similarity_features (
      media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,algorithm TEXT NOT NULL,hash TEXT NOT NULL,gradient TEXT NOT NULL,
      colors TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trash_entries (
      media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
      original_path TEXT NOT NULL, stored_path TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'moving', snapshot_json TEXT NOT NULL,
      retention_days INTEGER, expires_at TEXT, expiry_action TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_trash_expiry ON trash_entries(expires_at);
    CREATE TABLE IF NOT EXISTS organization_log (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS geo_runs (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      changes_json TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS job_items (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, output TEXT, file_path TEXT NOT NULL DEFAULT '', ordinal INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(task_id,media_id)
    );
    CREATE INDEX IF NOT EXISTS idx_job_items_status ON job_items(task_id,status);
    CREATE TABLE IF NOT EXISTS geo_changes (
      run_id TEXT NOT NULL REFERENCES geo_runs(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL, change_json TEXT NOT NULL,
      PRIMARY KEY(run_id,media_id)
    );
    CREATE TABLE IF NOT EXISTS media_tag_origins (
      media_id TEXT NOT NULL, tag_id TEXT NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY(media_id,tag_id), FOREIGN KEY(media_id,tag_id) REFERENCES media_tags(media_id,tag_id) ON DELETE CASCADE
    );
  `);
  const jobColumns = db.prepare('PRAGMA table_info(job_items)').all() as { name: string }[];
  if (!jobColumns.some((column) => column.name === 'file_path')) db.exec("ALTER TABLE job_items ADD COLUMN file_path TEXT NOT NULL DEFAULT ''");
  if (!jobColumns.some((column) => column.name === 'ordinal')) db.exec('ALTER TABLE job_items ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0');
  if (!jobColumns.some((column) => column.name === 'size_bytes')) db.exec('ALTER TABLE job_items ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0');
  if (!jobColumns.some((column) => column.name === 'fingerprint')) db.exec("ALTER TABLE job_items ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''");
  if(!(db.prepare('PRAGMA table_info(albums)').all() as {name:string}[]).some(row=>row.name==='parent_id'))db.exec('ALTER TABLE albums ADD COLUMN parent_id TEXT REFERENCES albums(id) ON DELETE SET NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS directory_settings(root_id TEXT PRIMARY KEY REFERENCES library_roots(id) ON DELETE CASCADE,auto_albums INTEGER NOT NULL DEFAULT 0,hierarchy INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS directory_rules(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,relative_path TEXT NOT NULL,tag_id TEXT NOT NULL REFERENCES tags(id),UNIQUE(root_id,relative_path,tag_id));
    CREATE INDEX IF NOT EXISTS idx_directory_rules_tag ON directory_rules(tag_id);
    CREATE TABLE IF NOT EXISTS directory_edges(parent_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,child_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,owned INTEGER NOT NULL,PRIMARY KEY(parent_id,child_id));
    CREATE TABLE IF NOT EXISTS directory_media_tags(media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(media_id,tag_id));
    CREATE INDEX IF NOT EXISTS idx_directory_media_tag ON directory_media_tags(tag_id,media_id);
    CREATE TABLE IF NOT EXISTS directory_albums(root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,relative_path TEXT NOT NULL,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,PRIMARY KEY(root_id,relative_path));
    CREATE TABLE IF NOT EXISTS directory_album_media(album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,owned INTEGER NOT NULL,PRIMARY KEY(album_id,media_id));`);
  const directoryRulesSchema=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='directory_rules'").get() as {sql:string}).sql;
  if(/UNIQUE\s*\(\s*root_id\s*,\s*relative_path\s*\)/iu.test(directoryRulesSchema))db.transaction(()=>{
    db.exec(`CREATE TABLE directory_rules_v11(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,relative_path TEXT NOT NULL,tag_id TEXT NOT NULL REFERENCES tags(id),UNIQUE(root_id,relative_path,tag_id));
      INSERT INTO directory_rules_v11 SELECT id,root_id,relative_path,tag_id FROM directory_rules;
      DROP TABLE directory_rules;
      ALTER TABLE directory_rules_v11 RENAME TO directory_rules;
      CREATE INDEX idx_directory_rules_tag ON directory_rules(tag_id);`);
  })();
  db.exec(`CREATE TABLE IF NOT EXISTS cache_inventory(file_path TEXT PRIMARY KEY,root TEXT NOT NULL,file_name TEXT NOT NULL,size_bytes INTEGER NOT NULL,stamp TEXT NOT NULL,revision INTEGER NOT NULL,present INTEGER NOT NULL DEFAULT 1);CREATE INDEX IF NOT EXISTS idx_cache_inventory_root ON cache_inventory(root,present);CREATE INDEX IF NOT EXISTS idx_cache_inventory_revision ON cache_inventory(revision);`);
  if(!(db.prepare('PRAGMA table_info(albums)').all() as {name:string}[]).some(row=>row.name==='is_folder'))db.exec('ALTER TABLE albums ADD COLUMN is_folder INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_albums_parent ON albums(parent_id);CREATE TABLE IF NOT EXISTS album_removal_undo(id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,detail_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_job_items_queue ON job_items(task_id,status,ordinal)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_directory_album_media_media ON directory_album_media(media_id,album_id)');
  db.prepare("UPDATE tasks SET status='paused', updated_at=CURRENT_TIMESTAMP WHERE status IN ('running','queued')").run();
  initializeVisibility(db);
  if((previousVersion??0)<11)migrateDirectoryTagTypes(db);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').run(schemaVersion);
  return db;
}

export function closeDatabase(db: LuminaDatabase): void {
  db.close();
}

export * from './repository.js';
export * from './tasks.js';
export * from './organization.js';
export * from './tag-hierarchy.js';

export * from './directory-rules.js';
export * from './album-management.js';
export {mediaOrder} from './media-sort.js';
export * from './visibility.js';
