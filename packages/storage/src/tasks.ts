import type { LuminaDatabase } from './index.js';

export interface TaskListRecord {
  id: string;
  kind: string;
  status: string;
  processed: number;
  total: number;
  errorCode: string | null;
  errorMessage: string | null;
  payloadJson: string | null;
}

export function listTasks(db: LuminaDatabase, limit = 50): TaskListRecord[] {
  return taskPage(db,Math.max(1,Math.min(limit,200))).items;
}

export type TaskFilter='all'|'pending'|'completed'|'failed';
export function taskPage(db:LuminaDatabase,limit=10,offset=0,filter:TaskFilter='all'){
  const where=filter==='pending'?"WHERE status IN('running','queued','paused')":filter==='completed'?"WHERE status='completed'":filter==='failed'?"WHERE status='failed'":'';
  const total=(db.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get() as {count:number}).count;
  const items=db.prepare(`SELECT id,kind,status,processed,total,error_code AS errorCode,error_message AS errorMessage,payload_json AS payloadJson,created_at AS createdAt,updated_at AS updatedAt FROM tasks ${where}
    ORDER BY CASE WHEN status IN('running','queued','paused') THEN 0 ELSE 1 END,created_at DESC,rowid DESC LIMIT ? OFFSET ?`).all(limit,offset) as TaskListRecord[];
  return {total,items};
}
