CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id)
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  price REAL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'un.',
  store TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (list_id) REFERENCES lists(id)
);
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL,
  quantity REAL NOT NULL DEFAULT 1,
  completed_at INTEGER NOT NULL,
  FOREIGN KEY (list_id) REFERENCES lists(id)
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id)
);
CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
CREATE INDEX IF NOT EXISTS idx_history_list ON history(list_id);
CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id);
