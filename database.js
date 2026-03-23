const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

// Créditos semanales — configurable desde .env (WEEKLY_AMOUNT=20000)
const DEFAULT_WEEKLY_CREDITS = parseInt(process.env.WEEKLY_AMOUNT) || 20000;
const DEFAULT_WELCOME_CREDITS = parseInt(process.env.WELCOME_AMOUNT) || 15000;

const db = new Database(path.join(__dirname, "letitride_casino.db"));

// ─── TABLAS ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     TEXT UNIQUE NOT NULL,
    group_name   TEXT,
    active       INTEGER DEFAULT 1,
    web_token    TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS group_settings (
    group_id             TEXT PRIMARY KEY,
    currency             TEXT DEFAULT 'Créditos',
    weekly_credits      INTEGER DEFAULT 20000,
    game_schedule       TEXT DEFAULT '20:00',
    game_days          TEXT DEFAULT '1,3,5',
    min_bet             INTEGER DEFAULT 10,
    max_bet             INTEGER DEFAULT 500,
    auto_payout         INTEGER DEFAULT 1,
    FOREIGN KEY (group_id) REFERENCES groups(group_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    group_id     TEXT NOT NULL,
    username     TEXT,
    phone_number TEXT,
    credits      INTEGER DEFAULT 0,
    last_credit_reset DATETIME,
    total_won    INTEGER DEFAULT 0,
    total_lost   INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, group_id),
    FOREIGN KEY (group_id) REFERENCES groups(group_id)
  );

  CREATE TABLE IF NOT EXISTS games (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     TEXT NOT NULL,
    game_type    TEXT DEFAULT 'roulette',
    status       TEXT DEFAULT 'waiting',
    winning_number INTEGER,
    winning_color TEXT,
    started_at   DATETIME,
    completed_at DATETIME,
    total_bets   INTEGER DEFAULT 0,
    total_payout INTEGER DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES groups(group_id)
  );

  CREATE TABLE IF NOT EXISTS bets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      INTEGER NOT NULL,
    user_id      TEXT NOT NULL,
    bet_type     TEXT NOT NULL,
    bet_value    TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    payout       INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'pending',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    group_id     TEXT NOT NULL,
    type         TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    description  TEXT,
    balance_after INTEGER,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(group_id)
  );
`);

// ─── MIGRACIONES AUTOMÁTICAS ──────────────────────────────────────────────────
// Resetear stats sucios del sistema viejo (que sumaba el monto apostado a total_lost)
// Solo corre una vez — detecta si hay valores anómalos (total_lost > total_won * 10)
try {
  const dirty = db.prepare(
    "SELECT COUNT(*) as n FROM users WHERE total_lost > 0 AND total_won = 0"
  ).get();
  if (dirty.n > 0) {
    db.exec("UPDATE users SET total_won = 0, total_lost = 0");
    console.log("🔧 Migración: stats de ganancia/pérdida reseteados (datos del sistema viejo).");
  }
} catch (e) {}
try {
  db.exec(`ALTER TABLE group_settings ADD COLUMN weekly_credits INTEGER DEFAULT 20000`);
} catch (e) {}

// Actualizar grupos existentes que todavía tienen el valor viejo (1000)
try {
  db.exec(`UPDATE group_settings SET weekly_credits = 20000 WHERE weekly_credits = 1000`);
} catch (e) {}

// ✅ FIX BUG #1: La migración del web_token va en la tabla 'groups', no en 'group_settings'
try {
  db.exec(`ALTER TABLE groups ADD COLUMN web_token TEXT`);
  console.log("🔧 Migración: Columna 'web_token' en 'groups' lista.");
} catch (e) {}

// ─── GRUPOS ───────────────────────────────────────────────────────────────────
function addGroup(groupId, groupName) {
  const token = crypto.randomBytes(8).toString('hex'); 
  
  const stmt = db.prepare(`
    INSERT INTO groups (group_id, group_name, active, web_token)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(group_id) DO UPDATE SET 
      active = 1, 
      group_name = excluded.group_name,
      web_token = COALESCE(groups.web_token, excluded.web_token)
  `);
  stmt.run(groupId, groupName, token);

  db.prepare(`INSERT OR IGNORE INTO group_settings (group_id) VALUES (?)`).run(groupId);
}

function removeGroup(groupId) {
  db.prepare(`UPDATE groups SET active = 0 WHERE group_id = ?`).run(groupId);
}

function getActiveGroups() {
  return db.prepare(`SELECT * FROM groups WHERE active = 1`).all();
}

function getGroup(groupId) {
  return db.prepare(`SELECT * FROM groups WHERE group_id = ?`).get(groupId);
}

function getGroupToken(groupId) {
  const row = db.prepare("SELECT web_token FROM groups WHERE group_id = ?").get(groupId);
  return row ? row.web_token : null;
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function getGroupSettings(groupId) {
  return db.prepare(`SELECT * FROM group_settings WHERE group_id = ?`).get(groupId);
}

function updateGroupSettings(groupId, settings) {
  const stmt = db.prepare(`
    UPDATE group_settings 
    SET currency = ?, weekly_credits = ?, game_schedule = ?, 
        game_days = ?, min_bet = ?, max_bet = ?, auto_payout = ?
    WHERE group_id = ?
  `);
  stmt.run(
    settings.currency || 'Créditos',
    settings.weekly_credits || DEFAULT_WEEKLY_CREDITS,
    settings.game_schedule || '20:00',
    settings.game_days || '1,3,5',
    settings.min_bet || 10,
    settings.max_bet || 500,
    settings.auto_payout !== undefined ? settings.auto_payout : 1,
    groupId
  );
}

// ─── USUARIOS ─────────────────────────────────────────────────────────────────
function getOrCreateUser(userId, groupId, username = null, phoneNumber = null) {
  let user = db.prepare(`SELECT * FROM users WHERE user_id = ? AND group_id = ?`).get(userId, groupId);
  
  if (!user) {
    const stmt = db.prepare(`
      INSERT INTO users (user_id, group_id, username, phone_number, credits)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(userId, groupId, username, phoneNumber, DEFAULT_WELCOME_CREDITS);
    // Registrar la acreditación inicial
    db.prepare(`
      INSERT INTO transactions (user_id, group_id, type, amount, description, balance_after)
      VALUES (?, ?, 'credit', ?, 'Créditos iniciales de bienvenida', ?)
    `).run(userId, groupId, DEFAULT_WELCOME_CREDITS, DEFAULT_WELCOME_CREDITS);
    user = db.prepare(`SELECT * FROM users WHERE user_id = ? AND group_id = ?`).get(userId, groupId);
  } else if (username && !user.username) {
    // Actualizar username si no lo tenía
    db.prepare(`UPDATE users SET username = ? WHERE user_id = ? AND group_id = ?`).run(username, userId, groupId);
    user.username = username;
  }
  
  return user;
}

// Actualiza total_won/total_lost con el resultado NETO de una apuesta.
// netResult > 0 → ganancia neta (se suma a total_won)
// netResult < 0 → pérdida neta (se suma a total_lost)
function updateBetStats(userId, groupId, netResult) {
  if (netResult > 0) {
    db.prepare(`UPDATE users SET total_won = total_won + ? WHERE user_id = ? AND group_id = ?`)
      .run(netResult, userId, groupId);
  } else if (netResult < 0) {
    db.prepare(`UPDATE users SET total_lost = total_lost + ? WHERE user_id = ? AND group_id = ?`)
      .run(Math.abs(netResult), userId, groupId);
  }
}

// Busca un usuario por número de teléfono (sin importar si es @lid o @c.us)
// Devuelve el user_id real con el que está registrado, o null si no existe
function findUserByPhone(phone, groupId) {
  // Normalizar: sacar todo después de @ y los : de los IDs multi-device
  const normalized = phone.split('@')[0].split(':')[0];
  return db.prepare(`
    SELECT * FROM users 
    WHERE group_id = ? AND (
      user_id LIKE ? OR user_id LIKE ?
    )
    ORDER BY credits DESC
    LIMIT 1
  `).get(groupId, normalized + '@c.us', normalized + '%');
}

function getUserCredits(userId, groupId) {
  const user = getOrCreateUser(userId, groupId);
  return user.credits;
}

// updateUserCredits solo maneja el saldo y el historial de transacciones.
// total_won y total_lost se actualizan por separado con updateBetStats().
function updateUserCredits(userId, groupId, amount, type, description) {
  const user = getOrCreateUser(userId, groupId);
  const newBalance = user.credits + amount;

  db.prepare(`
    UPDATE users 
    SET credits = ?
    WHERE user_id = ? AND group_id = ?
  `).run(newBalance, userId, groupId);
  
  db.prepare(`
    INSERT INTO transactions (user_id, group_id, type, amount, description, balance_after)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, groupId, type, amount, description, newBalance);
  
  return newBalance;
}

function resetWeeklyCredits(groupId) {
  const settings = getGroupSettings(groupId);
  const weeklyCredits = settings.weekly_credits || DEFAULT_WEEKLY_CREDITS;
  
  db.prepare(`
    UPDATE users 
    SET credits = ?, last_credit_reset = CURRENT_TIMESTAMP 
    WHERE group_id = ?
  `).run(weeklyCredits, groupId);
  
  console.log(`💰 Créditos semanales reseteados para grupo ${groupId}: ${weeklyCredits} créditos`);
}

function getTopUsers(groupId, limit = 10) {
  // GROUP BY username para evitar duplicados cuando el mismo jugador
  // tiene dos filas por distintos formatos de ID (@lid vs @c.us)
  return db.prepare(`
    SELECT username, MAX(credits) as credits,
           SUM(total_won) as total_won, SUM(total_lost) as total_lost
    FROM users 
    WHERE group_id = ? AND credits > 0 AND username IS NOT NULL
    GROUP BY username
    ORDER BY credits DESC 
    LIMIT ?
  `).all(groupId, limit);
}

// ✅ FIX BUG #3: Nueva función para evitar llamar db.prepare() desde commands.js e index.js
function getUserCount(groupId) {
  return db.prepare(`SELECT COUNT(*) as count FROM users WHERE group_id = ?`).get(groupId).count;
}

// ─── JUEGOS ───────────────────────────────────────────────────────────────────
function createGame(groupId) {
  const stmt = db.prepare(`
    INSERT INTO games (group_id, status, started_at)
    VALUES (?, 'active', CURRENT_TIMESTAMP)
  `);
  const result = stmt.run(groupId);
  return db.prepare(`SELECT * FROM games WHERE id = ?`).get(result.lastInsertRowid);
}

function getActiveGame(groupId) {
  return db.prepare(`
    SELECT * FROM games 
    WHERE group_id = ? AND status = 'active'
    ORDER BY started_at DESC 
    LIMIT 1
  `).get(groupId);
}

function getClosingGame(groupId) {
  return db.prepare(`
    SELECT * FROM games 
    WHERE group_id = ? AND status IN ('active', 'closing')
    ORDER BY started_at DESC 
    LIMIT 1
  `).get(groupId);
}

function closeGame(gameId) {
  db.prepare(`UPDATE games SET status = 'closing' WHERE id = ?`).run(gameId);
}

function completeGame(gameId, winningNumber, winningColor) {
  db.prepare(`
    UPDATE games 
    SET status = 'completed', winning_number = ?, winning_color = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(winningNumber, winningColor, gameId);
  
  return db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
}

// ─── APUESTAS ─────────────────────────────────────────────────────────────────
function placeBet(gameId, userId, betType, betValue, amount) {
  const stmt = db.prepare(`
    INSERT INTO bets (game_id, user_id, bet_type, bet_value, amount)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(gameId, userId, betType, betValue, amount);
  return db.prepare(`SELECT * FROM bets WHERE id = ?`).get(result.lastInsertRowid);
}

// ✅ FIX BUG #4: JOIN corregido — ahora filtra por group_id para no mezclar jugadores entre grupos
function getGameBets(gameId) {
  return db.prepare(`
    SELECT b.*, u.username 
    FROM bets b
    JOIN games g ON b.game_id = g.id
    JOIN users u ON b.user_id = u.user_id AND u.group_id = g.group_id
    WHERE b.game_id = ?
    ORDER BY b.created_at
  `).all(gameId);
}

function getUserBets(userId, gameId) {
  return db.prepare(`
    SELECT * FROM bets 
    WHERE game_id = ? AND user_id = ?
    ORDER BY created_at
  `).all(gameId, userId);
}

// ✅ FIX BUG #5: Nueva función para no llamar db.prepare() desde commands.js e index.js
function updateBetStatus(betId, payout, status) {
  db.prepare(`UPDATE bets SET payout = ?, status = ? WHERE id = ?`).run(payout, status, betId);
}

// ─── TRANSACCIONES ─────────────────────────────────────────────────────────────
function getUserTransactions(userId, groupId, limit = 50) {
  return db.prepare(`
    SELECT * FROM transactions 
    WHERE user_id = ? AND group_id = ?
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(userId, groupId, limit);
}

// ─── UTILIDADES DE RULETA ───────────────────────────────────────────────────────
const ROULETTE_NUMBERS = {
  0: { color: 'green', value: 0 },
  1: { color: 'red', value: 1 }, 2: { color: 'black', value: 2 }, 3: { color: 'red', value: 3 },
  4: { color: 'black', value: 4 }, 5: { color: 'red', value: 5 }, 6: { color: 'black', value: 6 },
  7: { color: 'red', value: 7 }, 8: { color: 'black', value: 8 }, 9: { color: 'red', value: 9 },
  10: { color: 'black', value: 10 }, 11: { color: 'black', value: 11 }, 12: { color: 'red', value: 12 },
  13: { color: 'black', value: 13 }, 14: { color: 'red', value: 14 }, 15: { color: 'black', value: 15 },
  16: { color: 'red', value: 16 }, 17: { color: 'black', value: 17 }, 18: { color: 'red', value: 18 },
  19: { color: 'red', value: 19 }, 20: { color: 'black', value: 20 }, 21: { color: 'red', value: 21 },
  22: { color: 'black', value: 22 }, 23: { color: 'red', value: 23 }, 24: { color: 'black', value: 24 },
  25: { color: 'red', value: 25 }, 26: { color: 'black', value: 26 }, 27: { color: 'red', value: 27 },
  28: { color: 'black', value: 28 }, 29: { color: 'black', value: 29 }, 30: { color: 'red', value: 30 },
  31: { color: 'black', value: 31 }, 32: { color: 'red', value: 32 }, 33: { color: 'black', value: 33 },
  34: { color: 'red', value: 34 }, 35: { color: 'black', value: 35 }, 36: { color: 'red', value: 36 }
};

function spinRoulette() {
  const numbers = Object.keys(ROULETTE_NUMBERS).map(Number);
  const winningNumber = numbers[Math.floor(Math.random() * numbers.length)];
  return {
    number: winningNumber,
    color: ROULETTE_NUMBERS[winningNumber].color,
    info: ROULETTE_NUMBERS[winningNumber]
  };
}

function calculateBetPayout(betType, betValue, winningNumber, winningColor) {
  const winInfo = ROULETTE_NUMBERS[winningNumber];
  
  switch (betType) {
    case 'number':
      return winInfo.value === parseInt(betValue) ? 36 : 0;
    case 'red':
      return winInfo.color === 'red' ? 2 : 0;
    case 'black':
      return winInfo.color === 'black' ? 2 : 0;
    case 'odd':
      return winInfo.value > 0 && winInfo.value % 2 === 1 ? 2 : 0;
    case 'even':
      return winInfo.value > 0 && winInfo.value % 2 === 0 ? 2 : 0;
    case 'low':
      return winInfo.value >= 1 && winInfo.value <= 18 ? 2 : 0;
    case 'high':
      return winInfo.value >= 19 && winInfo.value <= 36 ? 2 : 0;
    case 'dozen1':
      return winInfo.value >= 1 && winInfo.value <= 12 ? 3 : 0;
    case 'dozen2':
      return winInfo.value >= 13 && winInfo.value <= 24 ? 3 : 0;
    case 'dozen3':
      return winInfo.value >= 25 && winInfo.value <= 36 ? 3 : 0;
    case 'column1':
      return winInfo.value > 0 && winInfo.value % 3 === 1 ? 3 : 0;
    case 'column2':
      return winInfo.value > 0 && winInfo.value % 3 === 2 ? 3 : 0;
    case 'column3':
      return winInfo.value > 0 && winInfo.value % 3 === 0 ? 3 : 0;
    default:
      return 0;
  }
}

// ─── ESTADÍSTICAS GLOBALES (Panel Admin) ─────────────────────────────────────

function getGlobalStats() {
  // Totales globales
  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT b.id)                          AS total_bets,
      COALESCE(SUM(b.amount), 0)                    AS total_wagered,
      COALESCE(SUM(CASE WHEN b.status='won' THEN b.payout ELSE 0 END), 0) AS total_paid_out
    FROM bets b
    JOIN games gm ON b.game_id = gm.id
    JOIN groups g ON gm.group_id = g.group_id
  `).get();

  const totalGames = db.prepare("SELECT COUNT(*) AS count FROM games WHERE status='completed'").get().count;

  const totalPlayers = db.prepare(`SELECT COUNT(DISTINCT user_id) AS count FROM users`).get().count;
  const totalGroups = db.prepare(`SELECT COUNT(*) AS count FROM groups WHERE active=1`).get().count;

  const houseProfit = totals.total_wagered - totals.total_paid_out;

  return { ...totals, totalGames, totalPlayers, totalGroups, houseProfit };
}

function getPerGroupStats() {
  return db.prepare(`
    SELECT
      g.group_name,
      g.group_id,
      COUNT(DISTINCT u.user_id)                                        AS players,
      COUNT(DISTINCT CASE WHEN gm.status='completed' THEN gm.id END)     AS games_played,
      COALESCE(SUM(b.amount), 0)                                       AS total_wagered,
      COALESCE(SUM(CASE WHEN b.status='won' THEN b.payout ELSE 0 END), 0) AS total_paid_out
    FROM groups g
    LEFT JOIN users u        ON u.group_id = g.group_id
    LEFT JOIN games gm       ON gm.group_id = g.group_id
    LEFT JOIN bets b         ON b.game_id = gm.id
    WHERE g.active = 1
    GROUP BY g.group_id
    ORDER BY total_wagered DESC
  `).all().map(r => ({
    ...r,
    house_profit: r.total_wagered - r.total_paid_out
  }));
}

function getTopCreditsByGroup(groupId, limit = 10) {
  return db.prepare(`
    SELECT username, credits, total_won, total_lost
    FROM users
    WHERE group_id = ?
    ORDER BY credits DESC
    LIMIT ?
  `).all(groupId, limit);
}

function getTopCreditsGlobal(limit = 10) {
  return db.prepare(`
    SELECT u.username, u.credits, u.total_won, u.total_lost, g.group_name
    FROM users u
    JOIN groups g ON u.group_id = g.group_id
    WHERE g.active = 1
    ORDER BY u.credits DESC
    LIMIT ?
  `).all(limit);
}

function getTopWinnersGlobal(limit = 5) {
  return db.prepare(`
    SELECT username, group_id, total_won, total_lost, credits
    FROM users
    ORDER BY total_won DESC
    LIMIT ?
  `).all(limit);
}

function getRecentGames(limit = 10) {
  return db.prepare(`
    SELECT gm.id, gm.group_id, g.group_name, gm.winning_number, gm.winning_color,
           gm.completed_at,
           COUNT(b.id) AS bet_count,
           COALESCE(SUM(b.amount), 0) AS wagered,
           COALESCE(SUM(CASE WHEN b.status='won' THEN b.payout ELSE 0 END), 0) AS paid_out
    FROM games gm
    JOIN groups g ON gm.group_id = g.group_id
    LEFT JOIN bets b ON b.game_id = gm.id
    WHERE gm.status = 'completed'
    GROUP BY gm.id
    ORDER BY gm.completed_at DESC
    LIMIT ?
  `).all(limit).map(r => ({
    ...r,
    house_profit: r.wagered - r.paid_out
  }));
}

module.exports = {
  addGroup,
  removeGroup,
  getActiveGroups,
  getGroup,
  getGroupToken,
  getGroupSettings,
  updateGroupSettings,
  getOrCreateUser,
  findUserByPhone,
  getUserCredits,
  updateBetStats,
  updateUserCredits,
  resetWeeklyCredits,
  getTopUsers,
  getUserCount,
  createGame,
  getActiveGame,
  closeGame,
  completeGame,
  getClosingGame,
  placeBet,
  getGameBets,
  getUserBets,
  updateBetStatus,
  getUserTransactions,
  spinRoulette,
  calculateBetPayout,
  ROULETTE_NUMBERS,
  getGlobalStats,
  getPerGroupStats,
  getTopCreditsByGroup,
  getTopCreditsGlobal,
  getTopWinnersGlobal,
  getRecentGames
};