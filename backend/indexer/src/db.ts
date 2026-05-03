import Database from "better-sqlite3";

export interface HistoryRow {
  blockNumber: number;
  timestamp: number;
  multiplier: number;
  F: number;
  D: number;
  C: number;
  txHash: string;
}

export function openDb(path = "ascent.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      blockNumber INTEGER NOT NULL,
      timestamp   INTEGER NOT NULL,
      multiplier  REAL    NOT NULL,
      F           REAL    NOT NULL,
      D           REAL    NOT NULL,
      C           REAL    NOT NULL,
      txHash      TEXT    NOT NULL,
      PRIMARY KEY (blockNumber, txHash)
    );
    CREATE INDEX IF NOT EXISTS history_block_idx ON history(blockNumber DESC);

    CREATE TABLE IF NOT EXISTS cursor (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  const insert = db.prepare(
    `INSERT OR REPLACE INTO history
     (blockNumber, timestamp, multiplier, F, D, C, txHash)
     VALUES (@blockNumber, @timestamp, @multiplier, @F, @D, @C, @txHash)`,
  );
  const recent = db.prepare(
    `SELECT * FROM history ORDER BY blockNumber DESC, rowid DESC LIMIT ?`,
  );
  const getCursor = db.prepare(`SELECT value FROM cursor WHERE key = ?`);
  const setCursor = db.prepare(
    `INSERT OR REPLACE INTO cursor (key, value) VALUES (?, ?)`,
  );

  return {
    insert: (row: HistoryRow) => insert.run(row),
    recent: (limit: number) => (recent.all(limit) as HistoryRow[]).reverse(),
    cursor: {
      get: (k: string): number | null =>
        ((getCursor.get(k) as { value: number } | undefined)?.value ?? null),
      set: (k: string, v: number) => setCursor.run(k, v),
    },
  };
}
