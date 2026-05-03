import Database from "better-sqlite3";

export interface HistoryRow {
  poolId: string;
  blockNumber: number;
  timestamp: number;
  multiplier: number;
  treasury: number;
  F: number;
  V: number;
  D: number;
  C: number;
  txHash: string;
}

export function openDb(path = "ascent.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      poolId      TEXT    NOT NULL,
      blockNumber INTEGER NOT NULL,
      timestamp   INTEGER NOT NULL,
      multiplier  REAL    NOT NULL,
      treasury    REAL    NOT NULL,
      F           REAL    NOT NULL,
      V           REAL    NOT NULL,
      D           REAL    NOT NULL,
      C           REAL    NOT NULL,
      txHash      TEXT    NOT NULL,
      PRIMARY KEY (poolId, blockNumber, txHash)
    );
    CREATE INDEX IF NOT EXISTS history_pool_block_idx ON history(poolId, blockNumber DESC);

    CREATE TABLE IF NOT EXISTS cursor (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  const insert = db.prepare(
    `INSERT OR REPLACE INTO history
     (poolId, blockNumber, timestamp, multiplier, treasury, F, V, D, C, txHash)
     VALUES (@poolId, @blockNumber, @timestamp, @multiplier, @treasury, @F, @V, @D, @C, @txHash)`,
  );
  const recent = db.prepare(
    `SELECT * FROM history WHERE poolId = ? ORDER BY blockNumber DESC, rowid DESC LIMIT ?`,
  );
  const recentAll = db.prepare(
    `SELECT * FROM history ORDER BY blockNumber DESC, rowid DESC LIMIT ?`,
  );
  const getCursor = db.prepare(`SELECT value FROM cursor WHERE key = ?`);
  const setCursor = db.prepare(
    `INSERT OR REPLACE INTO cursor (key, value) VALUES (?, ?)`,
  );

  return {
    insert: (row: HistoryRow) => insert.run(row),
    recent: (poolId: string | undefined, limit: number) => {
      const rows = (poolId ? recent.all(poolId, limit) : recentAll.all(limit)) as HistoryRow[];
      return rows.reverse();
    },
    cursor: {
      get: (k: string): number | null =>
        ((getCursor.get(k) as { value: number } | undefined)?.value ?? null),
      set: (k: string, v: number) => setCursor.run(k, v),
    },
  };
}
