const db = require("./database");
const { exec } = require("child_process");
const { MessageMedia } = require("whatsapp-web.js");
const path = require("path");

const CREDIT_DAY = parseInt(process.env.CREDIT_DAY) || 5;
const BET_DURATION = parseInt(process.env.BET_DURATION) || 4; // minutos de apuestas
const POLL_THRESHOLD = parseFloat(process.env.POLL_THRESHOLD) || 0.2; // % del grupo para votar
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const creditDayName = DAY_NAMES[CREDIT_DAY];

// ─── AYUDA ────────────────────────────────────────────────────────────────────
const HELP_TEXT = `
🎰 *LetItRide Casino Bot* 🎲

*🎮 Juegos:*
▸ \`/casino start\` — Votación para iniciar ruleta
▸ \`/bet <monto> <objetivo...>\` — Apostar

*💡 Cómo apostar:*
El monto se cobra por cada objetivo. Máx. 15 objetivos por \`/bet\`.

*💰 Mínimos por tipo:*
• Número (0-36): 100 créditos → paga 35:1
• Rojo / Negro: 2.000 → paga 1:1
• Par / Impar: 2.000 → paga 1:1
• Altos / Bajos: 1.000 → paga 1:1
• Docenas (d1/d2/d3): 500 → paga 2:1
• Columnas (c1/c2/c3): 500 → paga 2:1

Ejemplos:
▸ \`/bet 500 7\` — 500 al número 7
▸ \`/bet 2000 rojo par\` — a rojo Y par (total: 4.000)
▸ \`/bet 1000 3 15 d1\` — a tres objetivos (total: 3.000)

*💰 Cuenta:*
▸ \`/balance\` — Ver tus créditos
▸ \`/top\` — Ranking del grupo
▸ \`/history\` — Tus últimas transacciones

*⚙️ Configuración (Solo Admins):*
▸ \`/LetItRide\` — Agregar el casino al grupo
▸ \`/casino remove\`
▸ \`/casino schedule HH:MM\` — Hora del juego automático
▸ \`/casino days 1,3,5\` — Días del juego automático
▸ \`/casino status\` — Estado del casino
`.trim();

// ─── UTILS ────────────────────────────────────────────────────────────────────
// ID del grupo admin — copialo del log cuando mandes /admin desde ese grupo
// Formato: "XXXXXXXXXX-XXXXXXXXXX@g.us"
// Dejalo vacío ("") para desactivar el filtro por grupo durante la configuración inicial
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || "";

const SUPER_ADMINS = ["5491100000000", "541100000000", "100000000000000"];

async function isAdmin(message, client) {
  try {
    let rawSenderId = message.author || message.from;
    if (rawSenderId && rawSenderId.includes('@lid')) {
      try {
        const contact = await message.getContact();
        if (contact && contact.number) rawSenderId = contact.number + '@c.us';
      } catch (e) {}
    }
    const number = rawSenderId.split('@')[0].split(':')[0];
    if (SUPER_ADMINS.includes(number)) return true;
    const chat = await message.getChat();
    if (!chat.isGroup) return false;
    const participant = chat.participants?.find((p) => {
      const pNumber = p.id.user || p.id._serialized.split('@')[0].split(':')[0];
      return pNumber === number;
    });
    return participant?.isAdmin || participant?.isSuperAdmin || false;
  } catch (error) {
    console.error("❌ Error en isAdmin:", error.message);
    return false;
  }
}

function getUserDisplayName(message) {
  try {
    return message._data.notifyName || message.author?.split('@')[0] || 'Jugador';
  } catch (e) {
    return 'Jugador';
  }
}

function formatCredits(amount) {
  return `${amount.toLocaleString('es-AR')} créditos`;
}

function formatBetType(betType, betValue) {
  const names = {
    'number':  `Número ${betValue}`,
    'red':     'Rojo',
    'black':   'Negro',
    'even':    'Par',
    'odd':     'Impar',
    'high':    'Altos (19-36)',
    'low':     'Bajos (1-18)',
    'dozen1':  '1ra Docena (1-12)',
    'dozen2':  '2da Docena (13-24)',
    'dozen3':  '3ra Docena (25-36)',
    'column1': '1ra Columna',
    'column2': '2da Columna',
    'column3': '3ra Columna',
  };
  return names[betType] || betType;
}

// ─── KEYWORDS DE APUESTA (Español → tipo interno) ─────────────────────────────
const KEYWORD_MAP = {
  'rojo':  'red',
  'negro': 'black',
  'par':   'even',
  'impar': 'odd',
  'altos': 'high',
  'bajos': 'low',
  'd1':    'dozen1',
  'd2':    'dozen2',
  'd3':    'dozen3',
  'c1':    'column1',
  'c2':    'column2',
  'c3':    'column3',
};

function parseTarget(token) {
  const lower = token.toLowerCase();
  if (KEYWORD_MAP[lower]) return { betType: KEYWORD_MAP[lower], betValue: '' };
  if (/^\d{1,2}$/.test(token)) {
    const n = parseInt(token);
    if (n >= 0 && n <= 36) return { betType: 'number', betValue: String(n) };
  }
  return null;
}

// ─── MÍNIMOS POR CATEGORÍA DE APUESTA ────────────────────────────────────────
const BET_MINIMUMS = {
  'number':  100,   // números 0-36
  'even':    2000,  // par
  'odd':     2000,  // impar
  'red':     2000,  // rojo
  'black':   2000,  // negro
  'dozen1':  500,   // d1
  'dozen2':  500,   // d2
  'dozen3':  500,   // d3
  'column1': 500,   // c1
  'column2': 500,   // c2
  'column3': 500,   // c3
  'high':    1000,  // altos
  'low':     1000,  // bajos
};

// Máximo de objetivos distintos por comando /bet
const MAX_BET_TARGETS = 15;

// ─── VALIDADORES DE COMANDOS ──────────────────────────────────────────────────
// ─── SUBCOMANDOS VÁLIDOS DE /casino ─────────────────────────────────────────
const VALID_SUBCOMMANDS = ["help", "add", "remove", "status", "start", "schedule", "days", "give"];

const COMMAND_RULES = {
  "/balance": [1, 1],
  "/top":     [1, 1],
  "/history": [1, 1],
  "/stop":    [1, 1],
  "/casino":  [2, 5],  // /casino give @user 5000
  "/letitride": [1, 1],
  "/bet":     [3, 17], // cmd + monto + hasta MAX_BET_TARGETS=15 targets
  "/admin":   [1, 2],
};

// Longitud máxima del body por comando (en caracteres)
const COMMAND_MAX_LENGTH = {
  "/balance": 8,
  "/top":     4,
  "/history": 8,
  "/stop":    5,
  "/casino":  50,  // /casino give @user 20000 needs more room
  "/letitride": 11,
  "/bet":     100, // "/bet 50000 rojo negro par impar altos bajos d1 d2 d3 c1 c2 c3 7 15" ≈ 15 targets
  "/admin":   20,
};

function validateCommand(parts) {
  const cmd = parts[0].toLowerCase();
  const rule = COMMAND_RULES[cmd];
  if (!rule) return true;

  const fullBody = parts.join(" ");

  // ── FAIL-FAST: longitud primero ───────────────────────────────────────────
  // Si el cuerpo supera el límite, abortamos ANTES de cualquier regex o loop.
  // Esto evita que strings enormes pasen por todos los checks.
  const maxLen = COMMAND_MAX_LENGTH[cmd];
  if (maxLen && fullBody.length > maxLen) return false;

  // ── FAIL-FAST: cantidad de partes ─────────────────────────────────────────
  // Si tiene demasiados o muy pocos tokens, no tiene sentido seguir validando.
  const [min, max] = rule;
  if (parts.length < min || parts.length > max) return false;

  // A partir de acá el mensaje tiene tamaño y forma válidos.
  // Ahora buscamos contenido malicioso.

  // 1. Rechazar null bytes y caracteres de control
  for (let i = 0; i < fullBody.length; i++) {
    const code = fullBody.charCodeAt(i);
    if (code === 0 || (code >= 1 && code <= 8) || (code >= 11 && code <= 31) || code === 127) return false;
  }

  // 2. Rechazar caracteres Unicode peligrosos (RTL override, zero-width, BOM)
  if (/[​-‏‪-‮⁠-⁤﻿]/.test(fullBody)) return false;

  // 3. Rechazar emoji flood — bytes UTF-8 > 1.5× largo en chars
  if (Buffer.byteLength(fullBody, "utf8") > fullBody.length * 1.5) return false;

  // 4. Rechazar HTML/JS injection
  if (/<|>|javascript\s*:|on[a-z]+\s*=/i.test(fullBody)) return false;

  // 5. Rechazar shell injection y path traversal (solo /casino y /bet)
  if (cmd === "/casino" || cmd === "/bet") {
    const args = fullBody.slice(cmd.length);
    if (/[`$;|&{}()[\]'"\\]/.test(args)) return false;
    if (/\.\./.test(args)) return false;
    if (/--|(?:UNION|SELECT|DROP|INSERT|UPDATE|DELETE|ALTER|FROM|WHERE)\s/i.test(args)) return false;
  }

  // 6. Rechazar números de más de 15 dígitos en /bet
  if (cmd === "/bet") {
    if (parts.some(p => /^\d{16,}$/.test(p))) return false;
  }

  return true;
}

// ─── POLL DE VOTACIÓN ─────────────────────────────────────────────────────────
const pendingPolls = new Map();

async function handlePollReaction(reaction, client) {
  try {
    const msgId = reaction.msgId?._serialized;
    if (!msgId) return;
    for (const [groupId, poll] of pendingPolls.entries()) {
      if (poll.msgId !== msgId) continue;
      const voterId = reaction.senderId;
      if (!voterId) break;
      if (reaction.reaction === '👍') {
        if (reaction.read === false) {
          poll.yesVoters.add(voterId);
          console.log(`🗳️ Voto SÍ en ${groupId}: ${poll.yesVoters.size}/${poll.needed}`);
        } else {
          poll.yesVoters.delete(voterId);
          console.log(`🗳️ Voto retirado en ${groupId}: ${poll.yesVoters.size}/${poll.needed}`);
        }
      }

      // ¿Se alcanzó el umbral? → lanzar inmediatamente sin esperar el timeout
      if (poll.yesVoters.size >= poll.needed) {
        clearTimeout(poll.timeoutId);
        pendingPolls.delete(groupId);
        console.log(`✅ Umbral alcanzado en ${groupId} — lanzando juego`);
        await client.sendMessage(groupId,
          `✅ *¡Votación aprobada!* ${poll.yesVoters.size}/${poll.needed} votos 🎉\n¡La partida arranca ya!`
        );
        const grp = db.getGroup(groupId);
        await launchGame(client, groupId, grp?.group_name || '');
      }

      break;
    }
  } catch (err) {
    console.error("❌ Error en handlePollReaction:", err.message);
  }
}

// ─── LANZAR JUEGO ─────────────────────────────────────────────────────────────
async function launchGame(client, groupId, groupName) {
  try {
    const existing = db.getActiveGame(groupId);
    if (existing) {
      await client.sendMessage(groupId, `⚠️ Ya hay un juego activo (#${existing.id}). Esperá a que termine.`);
      return;
    }
    const game = db.createGame(groupId);
    const settings = db.getGroupSettings(groupId);
    const minBet = settings?.min_bet || 100;

    await client.sendMessage(groupId,
      `🎰 *PARTIDA INICIADA* 🎲\n\n` +
      `📋 Juego: #${game.id}\n` +
      `⏰ *${BET_DURATION} minutos para apostar*\n` +
      `💰 Mínimo por objetivo: ${formatCredits(minBet)}\n\n` +
      `*Ejemplos:*\n` +
      `▸ \`/bet 500 7\`\n` +
      `▸ \`/bet 200 rojo par\`\n` +
      `▸ \`/bet 100 3 15 22\`\n\n` +
      `🎯 Objetivos: 0-36, rojo, negro, par, impar, altos, bajos, d1/d2/d3, c1/c2/c3\n\n` +
      `¡Buena suerte!`
    );

    // Aviso 30 segundos antes del cierre
    setTimeout(async () => {
      const stillActive = db.getActiveGame(groupId);
      if (stillActive && stillActive.id === game.id) {
        await client.sendMessage(groupId,
          `⏰ *¡30 segundos para cerrar apuestas!* ⚠️

Última chance para apostar antes de que gire la ruleta.`
        );
      }
    }, (BET_DURATION * 60 - 30) * 1000); // 30s antes del cierre

    // Girar al cumplirse los 2 minutos
    setTimeout(async () => {
      const stillActive = db.getActiveGame(groupId);
      if (stillActive && stillActive.id === game.id) {
        db.closeGame(game.id);
        await client.sendMessage(groupId, `🚫 *¡Las apuestas están cerradas!* No se aceptan más \`/bet\`.\n\n🎰 Girando la ruleta...`);
      }
      await spinAndReport(client, groupId, game.id);
    }, BET_DURATION * 60 * 1000);
  } catch (err) {
    console.error(`❌ Error en launchGame para ${groupName}:`, err.message);
  }
}

// ─── SPIN + RESULTADOS ────────────────────────────────────────────────────────
async function spinAndReport(client, groupId, gameId) {
  try {
    const activeGame = db.getClosingGame(groupId);
    if (!activeGame || activeGame.id !== gameId) return;


    await new Promise(r => setTimeout(r, 5000));
    // 1. Enviar sticker de ruleta girando
    try {
      const stickerPath = path.join(__dirname, "Stickers", "LetItRide!!.20");
      const stickerData = require("fs").readFileSync(stickerPath).toString("base64");
      const media = new MessageMedia("image/webp", stickerData);
      await client.sendMessage(groupId, media, { sendMediaAsSticker: true });
    } catch (stickerErr) {
      console.warn("⚠️ No se pudo enviar el sticker:", stickerErr.message);
    }

    await new Promise(r => setTimeout(r, 3000));

    // 2. Mensaje de transición
    await client.sendMessage(groupId, "🎰 *La ruleta está girando...* 🌀");

    // Pequeña pausa dramática
    await new Promise(r => setTimeout(r, 10000));

    const result = db.spinRoulette();
    db.completeGame(activeGame.id, result.number, result.color);

    const bets = db.getGameBets(activeGame.id);
    let totalPayout = 0;
    const winners = [];

    for (const bet of bets) {
      const multiplier = db.calculateBetPayout(bet.bet_type, bet.bet_value, result.number, result.color);
      const winAmount = multiplier * bet.amount;
      const netResult = winAmount - bet.amount; // neto: lo que ganó/perdió realmente

      if (winAmount > 0) {
        // Acreditar la ganancia bruta al saldo
        db.updateUserCredits(bet.user_id, groupId, winAmount, 'win',
          `Ganancia - ${formatBetType(bet.bet_type, bet.bet_value)}`);
        winners.push({ username: bet.username, amount: netResult, bet: formatBetType(bet.bet_type, bet.bet_value) });
        totalPayout += winAmount;
      }
      // Registrar el resultado neto en los stats
      db.updateBetStats(bet.user_id, groupId, netResult);
      db.updateBetStatus(bet.id, winAmount, winAmount > 0 ? 'won' : 'lost');
    }

    const colorEmoji = result.color === 'red' ? '🔴' : result.color === 'black' ? '⚫' : '🟢';
    const colorName = result.color === 'red' ? 'Rojo' : result.color === 'black' ? 'Negro' : 'Verde';
    let msg = `🎰 *RESULTADO DE LA RULETA* 🎰\n\n`;
    msg += `${colorEmoji} *Número: ${result.number} — ${colorName}*\n\n`;
    if (winners.length > 0) {
      msg += `🏆 *GANADORES*\n`;
      winners.forEach(w => { msg += `👤 ${w.username}: +${w.amount.toLocaleString('es-AR')} créditos (${w.bet})\n`; });
      msg += `\n💰 Total pagado: ${formatCredits(totalPayout)}`;
    } else {
      msg += `😅 *Sin ganadores esta ronda*\n💰 El casino conserva todo`;
    }
    msg += `\n📊 ${bets.length} apuesta${bets.length !== 1 ? 's' : ''} registrada${bets.length !== 1 ? 's' : ''}`;
    await client.sendMessage(groupId, msg);
  } catch (err) {
    console.error(`❌ Error en spinAndReport:`, err.message);
  }
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
async function handleCommand(message, client) {
  try {
    const body = message.body?.trim() || "";
    const groupId = message.fromMe ? message.to : message.from;
    const userId = message.author || message.from;

    let group = db.getGroup(groupId);
    const parts = body.split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const subcommand = (parts[1] || "").toLowerCase();

    if (!validateCommand(parts))
      return message.reply('❌ Comando mal escrito. Usá `/casino help` para ver el uso correcto.');

    // ─── BLOQUEO EN GRUPO ADMIN ───────────────────────────────────────────────
    // En el grupo de gestión solo funciona /admin — todo lo demás se ignora
    if (command !== "/admin" && ADMIN_GROUP_ID && groupId === ADMIN_GROUP_ID) {
      return; // Silencio total
    }

    // /stop
    if (command === "/stop") {
      const number = userId.split('@')[0].split(':')[0];
      if (!SUPER_ADMINS.includes(number))
        return message.reply("⛔ No tenés autorización para esto.");
      await message.reply("⚠️ *EMERGENCIA* — Apagando bot...");
      exec("pm2 stop letitride-casino-bot", (e, out) => {
        if (e) console.error(`❌ ${e.message}`);
        else console.log(`✅ ${out}`);
      });
      return;
    }

    // /balance
    if (command === "/balance") {
      if (!group || !group.active)
        return message.reply("❌ El casino no está activo. Un admin debe usar `/LetItRide`.");
      const user = db.getOrCreateUser(userId, groupId, getUserDisplayName(message));
      const settings = db.getGroupSettings(groupId);
      return message.reply(
        `💰 *Tu Balance*\n\n` +
        `👤 ${user.username || 'Jugador'}\n` +
        `💳 Créditos: ${formatCredits(user.credits)}\n` +
        `🏆 Total Ganado: ${formatCredits(user.total_won)}\n` +
        `💸 Total Perdido: ${formatCredits(user.total_lost)}\n` +
        `🎰 Moneda: ${settings?.currency || 'Créditos'}`
      );
    }

    // /top
    if (command === "/top") {
      if (!group || !group.active)
        return message.reply("❌ El casino no está activo en este grupo.");
      const topUsers = db.getTopUsers(groupId, 10);
      if (topUsers.length === 0)
        return message.reply("📊 Aún no hay jugadores con créditos.");
      let ranking = `🏆 *Ranking — ${group.group_name}*\n\n`;
      topUsers.forEach((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        ranking += `${medal} ${u.username || 'Jugador'}: ${formatCredits(u.credits)}\n`;
      });
      return message.reply(ranking);
    }

    // /history
    if (command === "/history") {
      if (!group || !group.active)
        return message.reply("❌ El casino no está activo en este grupo.");
      const transactions = db.getUserTransactions(userId, groupId, 10);
      if (transactions.length === 0)
        return message.reply("📜 No tenés transacciones registradas.");
      let hist = `📜 *Tu Historial Reciente*\n\n`;
      transactions.forEach((t) => {
        const emoji = t.type === 'credit' ? '💰' : t.type === 'bet' ? '🎲' : t.type === 'win' ? '🏆' : '💸';
        const sign = t.amount > 0 ? '+' : '';
        hist += `${emoji} ${t.description}: ${sign}${formatCredits(t.amount)}\n`;
      });
      return message.reply(hist);
    }

    // /LetItRide — agregar casino al grupo (alias de /casino add)
    if (command === "/letitride") {
      if (group && group.active)
        return message.reply('ℹ️ El casino ya está activo en este grupo. Usá `/casino help` para ver los comandos.');
      const admin = await isAdmin(message, client);
      if (!admin) return message.reply("🔒 Solo los administradores pueden agregar el casino.");
      const chat = await message.getChat();
      db.addGroup(groupId, chat.name);
      const welcomeMsg =
        `🎰 *¡Bienvenidos a Let It Ride!* 🎲\n\n` +
        `El casino está operativo en *${chat.name}*!\n\n` +
        `💰 Cada jugador recibirá créditos todos los ${creditDayName}.\n` +
        `🎮 Usá \`/casino help\` para ver todos los comandos.\n\n` +
        `¡Que comiencen los juegos! 🍀`;
      try { await message.reply(welcomeMsg); }
      catch (e) { await client.sendMessage(groupId, welcomeMsg); }
      return;
    }

    // /casino
    if (command === "/casino") {
      if (!subcommand)
        return message.reply('❓ Usá `/casino help` para ver los comandos disponibles.');

      if (!VALID_SUBCOMMANDS.includes(subcommand))
        return message.reply(`❓ Subcomando desconocido: "${subcommand}". Usá \`/casino help\` para ver los comandos disponibles.`);

      if (subcommand === "help")
        return message.reply(HELP_TEXT);

      const needsActive = ["status", "schedule", "days", "start"];
      if (needsActive.includes(subcommand) && (!group || !group.active))
        return message.reply("❌ El casino no está activo. Usá `/LetItRide` primero.");

      if (subcommand === "add") {
        if (parts.length !== 2)
          return message.reply("💡 Usá `/LetItRide` para agregar el casino al grupo.");
        if (group && group.active)
          return message.reply("ℹ️ El casino ya está activo en este grupo.");
        const admin = await isAdmin(message, client);
        if (!admin) return message.reply("🔒 Solo los administradores pueden agregar el casino.");
        const chat = await message.getChat();
        db.addGroup(groupId, chat.name);
        const welcomeMsg =
          `🎰 *¡Bienvenidos a Let It Ride!* 🎲\n\n` +
          `El casino está operativo en *${chat.name}*!\n\n` +
          `💰 Cada jugador recibirá créditos todos los ${creditDayName}.\n` +
          `🎮 Usá \`/casino help\` para ver todos los comandos.\n\n` +
          `¡Que comiencen los juegos! 🍀`;
        try { await message.reply(welcomeMsg); }
        catch (e) { await client.sendMessage(groupId, welcomeMsg); }
        return;
      }

      if (subcommand === "remove") {
        if (parts.length !== 2)
          return message.reply("❌ Uso: `/casino remove`  (sin argumentos extra)");
        const admin = await isAdmin(message, client);
        if (!admin) return message.reply("🔒 Solo los administradores pueden quitar el casino.");
        db.removeGroup(groupId);
        return message.reply(`🏠 El casino cerró sus puertas. ¡Vuelvan pronto! 🎰`);
      }

      if (subcommand === "status") {
        if (parts.length !== 2)
          return message.reply("❌ Uso: `/casino status`  (sin argumentos extra)");
        const settings = db.getGroupSettings(groupId);
        const activeGame = db.getActiveGame(groupId);
        const totalUsers = db.getUserCount(groupId);
        const hasPoll = pendingPolls.has(groupId);
        let s = `📊 *Estado del Casino — ${group.group_name}*\n\n`;
        s += `🎰 Juego: ${activeGame ? `🟢 En curso (#${activeGame.id})` : hasPoll ? '🗳️ Votación en curso' : '🔴 Inactivo'}\n`;
        s += `👥 Jugadores registrados: ${totalUsers}\n`;
        s += `💰 Créditos semanales: ${formatCredits(settings?.weekly_credits || 20000)}\n`;
        s += `🕐 Horario automático: ${settings?.game_schedule || '20:00'}\n`;
        s += `📅 Días automáticos: ${settings?.game_days || '1,3,5'}\n`;
        s += `💳 Moneda: ${settings?.currency || 'Créditos'}`;
        return message.reply(s);
      }

      const adminCmds = ["schedule", "days"];
      if (adminCmds.includes(subcommand)) {
        const admin = await isAdmin(message, client);
        if (!admin) return message.reply("🔒 Solo los administradores pueden usar este comando.");
      }

      if (subcommand === "schedule") {
        const time = parts[2];
        if (!time || !/^\d{2}:\d{2}$/.test(time))
          return message.reply("❌ Uso: `/casino schedule HH:MM`  Ej: `/casino schedule 20:00`");
        const settings = db.getGroupSettings(groupId);
        db.updateGroupSettings(groupId, { ...settings, game_schedule: time });
        return message.reply(`✅ Horario actualizado: ${time}`);
      }

      if (subcommand === "days") {
        const days = parts[2];
        if (!days)
          return message.reply("❌ Uso: `/casino days 1,3,5`  (1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb, 0=Dom)");
        const settings = db.getGroupSettings(groupId);
        db.updateGroupSettings(groupId, { ...settings, game_days: days });
        return message.reply(`✅ Días de juego actualizados: ${days}`);
      }

      if (subcommand === "start") {
        if (parts.length !== 2)
          return message.reply("❌ Uso: `/casino start`  (sin argumentos extra)");
        if (db.getActiveGame(groupId))
          return message.reply('🎰 Ya hay un juego activo. Esperá a que termine antes de iniciar otra.');

        // ── SuperAdmin: arrancar sin votación (cancela poll si hay uno) ──────
        const senderNumber = userId.split('@')[0].split(':')[0];
        if (SUPER_ADMINS.includes(senderNumber)) {
          if (pendingPolls.has(groupId)) {
            const poll = pendingPolls.get(groupId);
            clearTimeout(poll.timeoutId);
            pendingPolls.delete(groupId);
            await client.sendMessage(groupId, `🚫 *Votación cancelada por SuperAdmin.*`);
          }
          await client.sendMessage(groupId, `🎰 *¡Partida iniciada por SuperAdmin!* 🎲`);
          await launchGame(client, groupId, group?.group_name || '');
          return;
        }

        if (pendingPolls.has(groupId))
          return message.reply(`🗳️ Ya hay una votación en curso.`);

        const chat = await message.getChat();
        const totalParticipants = chat.participants?.length || 10;
        const needed = Math.max(1, Math.ceil(totalParticipants * POLL_THRESHOLD));

        const pollMsg = await client.sendMessage(groupId,
          `🗳️ *¿Iniciamos una partida de ruleta?*\n\n` +
          `Reaccioná con 👍 para votar SÍ.\n` +
          `Se necesitan *${needed} votos* (${Math.round(POLL_THRESHOLD * 100)}% del grupo — ${totalParticipants} participantes).\n\n` +
          `⏰ Tienen *10 minutos* para votar.`
        );

        const timeoutId = setTimeout(async () => {
          const poll = pendingPolls.get(groupId);
          pendingPolls.delete(groupId);
          if (!poll) return;
          const yesCount = poll.yesVoters.size;
          if (yesCount >= poll.needed) {
            await client.sendMessage(groupId,
              `✅ *¡Votación aprobada!* ${yesCount}/${poll.needed} votos 🎉\n¡La partida arranca ya!`
            );
            const grp = db.getGroup(groupId);
            await launchGame(client, groupId, grp?.group_name || '');
          } else {
            await client.sendMessage(groupId,
              `❌ *Votación terminada.* Solo ${yesCount}/${poll.needed} votos.\nNo se alcanzó el 40%. No se inicia la partida.`
            );
          }
        }, 10 * 60 * 1000);

        pendingPolls.set(groupId, {
          msgId: pollMsg.id._serialized,
          yesVoters: new Set(),
          needed,
          timeoutId,
        });

        return;
      }

      // /casino give @mention monto — solo SuperAdmin
      if (subcommand === "give") {
        const senderNum = userId.split('@')[0].split(':')[0];
        if (!SUPER_ADMINS.includes(senderNum))
          return message.reply("⛔ Solo el SuperAdmin puede dar créditos.");

        // El monto es el último token que sea número
        const giveAmount = parseInt(parts[parts.length - 1]);
        if (!giveAmount || isNaN(giveAmount) || giveAmount < 1)
          return message.reply('❌ Uso: `/casino give @usuario <monto>`\nEj: `/casino give @Sora 5000`');

        // Buscar la mención — whatsapp-web.js expone message.mentionedIds
        const mentioned = message.mentionedIds;
        if (!mentioned || mentioned.length === 0)
          return message.reply("❌ Mencioná al usuario con @. Ej: `/casino give @Sora 5000`");

        const rawId = mentioned[0];

        // Buscar al usuario por número, sin importar si está guardado como @lid o @c.us
        const existingUser = db.findUserByPhone(rawId, groupId);
        if (!existingUser)
          return message.reply("❌ Ese usuario nunca interactuó con el bot en este grupo. Pedile que mande `/balance` primero.");

        const realId = existingUser.user_id;
        const newBalance = db.updateUserCredits(realId, groupId, giveAmount, 'credit', 'Regalo de SuperAdmin');
        const targetName = existingUser.username || realId.split('@')[0].split(':')[0];

        return message.reply(
          `💰 *Créditos otorgados*\n\n` +
          `👤 ${targetName}\n` +
          `➕ ${formatCredits(giveAmount)}\n` +
          `💳 Nuevo saldo: ${formatCredits(newBalance)}`
        );
      }

      return message.reply('❓ Subcomando desconocido. Usá `/casino help`.');
    }

    // /bet
    if (command === "/bet") {
      if (!group || !group.active)
        return message.reply("❌ El casino no está activo en este grupo.");
      const activeGame = db.getActiveGame(groupId);
      if (!activeGame) {
        // Verificar si hay un juego cerrando apuestas
        const closingGame = db.getClosingGame(groupId);
        if (closingGame)
          return message.reply("🚫 Las apuestas ya cerraron para esta ronda. ¡Esperá la próxima!");
        return message.reply("🎰 No hay ningún juego activo. Esperá a que inicie una ronda.");
      }

      const args = parts.slice(1);
      const amountStr = args.find(a => /^\d{3,}$/.test(a));
      if (!amountStr)
        return message.reply('❌ El monto debe ser de 100 o más (3+ dígitos).\nEj: `/bet 500 7`  o  `/bet 200 rojo par`');

      const amount = parseInt(amountStr);
      const targetTokens = args.filter(a => a !== amountStr);

      if (targetTokens.length === 0)
        return message.reply('❌ Falta el objetivo de la apuesta.\nEj: `/bet 500 rojo`  o  `/bet 200 7 15 d2`');

      // Validar targets
      const parsedTargets = [];
      for (const token of targetTokens) {
        const parsed = parseTarget(token);
        if (!parsed) {
          return message.reply(
            `❌ Objetivo inválido: *${token}*\n\n` +
            `Usá números del 0 al 36, o palabras clave:\n` +
            `rojo, negro, par, impar, altos, bajos, d1/d2/d3, c1/c2/c3`
          );
        }
        parsedTargets.push(parsed);
      }

      const totalCost = amount * parsedTargets.length;
      const user = db.getOrCreateUser(userId, groupId, getUserDisplayName(message));
      const settings = db.getGroupSettings(groupId);

      // ── Mínimos por categoría ──────────────────────────────────────────────
      const invalidMins = [];
      for (const t of parsedTargets) {
        const catMin = BET_MINIMUMS[t.betType] || 100;
        if (amount < catMin)
          invalidMins.push(`• ${formatBetType(t.betType, t.betValue)}: mínimo ${formatCredits(catMin)}`);
      }
      if (invalidMins.length > 0)
        return message.reply(
          `❌ Monto insuficiente para algunos objetivos:\n\n${invalidMins.join("\n")}\n\nTu monto: ${formatCredits(amount)}`
        );

      if (user.credits < totalCost)
        return message.reply(
          `❌ Créditos insuficientes.\n` +
          `💸 Esta apuesta cuesta: ${formatCredits(totalCost)}\n` +
          `💳 Tu saldo: ${formatCredits(user.credits)}`
        );

      // Cobrar y registrar directamente
      const newBalance = db.updateUserCredits(userId, groupId, -totalCost, 'bet',
        `Apuesta (${parsedTargets.length} objetivo${parsedTargets.length > 1 ? 's' : ''})`);

      for (const t of parsedTargets) {
        db.placeBet(activeGame.id, userId, t.betType, t.betValue, amount);
      }

      let confirmMsg = `🎲 *Apuesta registrada*\n\n`;
      confirmMsg += `💰 ${formatCredits(amount)} × ${parsedTargets.length} = ${formatCredits(totalCost)}\n\n`;
      confirmMsg += `*Tus apuestas:*\n`;
      parsedTargets.forEach(t => { confirmMsg += `  • ${formatBetType(t.betType, t.betValue)}\n`; });
      confirmMsg += `\n💳 Saldo restante: ${formatCredits(newBalance)}\n🎰 ¡Buena suerte!`;

      return message.reply(confirmMsg);
    }

    // /admin — solo desde el grupo "Let It Ride", solo para super admins
    if (command === "/admin") {
      // Verificar que sea el grupo admin (si está configurado)
      if (ADMIN_GROUP_ID && groupId !== ADMIN_GROUP_ID) {
        return; // Silencio total fuera del grupo admin
      }

      // Verificar super admin
      const number = userId.split('@')[0].split(':')[0];
      if (!SUPER_ADMINS.includes(number)) return;

      const sub = (parts[1] || "resumen").toLowerCase();

      // /admin resumen — estadísticas globales
      if (sub === "resumen" || sub === "r") {
        const g = db.getGlobalStats();
        const pct = g.total_wagered > 0
          ? ((g.houseProfit / g.total_wagered) * 100).toFixed(1)
          : "0.0";

        let msg = `🎰 *Panel Admin — Resumen Global*\n\n`;
        msg += `🏠 Grupos activos: ${g.totalGroups}\n`;
        msg += `👥 Jugadores totales: ${g.totalPlayers}\n`;
        msg += `🎲 Partidas jugadas: ${g.totalGames}\n`;
        msg += `📊 Apuestas totales: ${g.total_bets}\n\n`;
        msg += `💸 Total apostado: ${formatCredits(g.total_wagered)}\n`;
        msg += `🏆 Total premios: ${formatCredits(g.total_paid_out)}\n`;
        msg += `🏦 *Ganancia de la casa: ${formatCredits(g.houseProfit)} (${pct}%)*`;
        return message.reply(msg);
      }

      // /admin grupos — desglose por grupo
      if (sub === "grupos" || sub === "g") {
        const grupos = db.getPerGroupStats();
        if (grupos.length === 0)
          return message.reply("📊 No hay datos de grupos todavía.");

        let msg = `🏠 *Estadísticas por Grupo*\n\n`;
        grupos.forEach((g, i) => {
          const pct = g.total_wagered > 0
            ? ((g.house_profit / g.total_wagered) * 100).toFixed(1)
            : "0.0";
          msg += `${i + 1}. *${g.group_name}*\n`;
          msg += `   👥 ${g.players} jugadores | 🎲 ${g.games_played} partidas\n`;
          msg += `   💸 Apostado: ${formatCredits(g.total_wagered)}\n`;
          msg += `   🏆 Premios: ${formatCredits(g.total_paid_out)}\n`;
          msg += `   🏦 Casa: ${formatCredits(g.house_profit)} (${pct}%)\n\n`;
        });
        return message.reply(msg);
      }

      // /admin top — mejores ganadores globales
      if (sub === "top" || sub === "t") {
        const winners = db.getTopWinnersGlobal(10);
        if (winners.length === 0)
          return message.reply("🏆 No hay ganadores registrados todavía.");

        let msg = `🏆 *Top Ganadores — Todos los Grupos*\n\n`;
        winners.forEach((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          msg += `${medal} ${u.username || 'Jugador'}: +${formatCredits(u.total_won)}\n`;
        });
        return message.reply(msg);
      }

      // /admin partidas — últimas 10 partidas
      if (sub === "partidas" || sub === "p") {
        const games = db.getRecentGames(10);
        if (games.length === 0)
          return message.reply("🎲 No hay partidas completadas todavía.");

        let msg = `🎲 *Últimas Partidas*\n\n`;
        games.forEach(gm => {
          const colorEmoji = gm.winning_color === 'red' ? '🔴' : gm.winning_color === 'black' ? '⚫' : '🟢';
          const profit = gm.house_profit >= 0 ? `+${formatCredits(gm.house_profit)}` : formatCredits(gm.house_profit);
          msg += `${colorEmoji} *${gm.group_name}* — Nº${gm.winning_number}\n`;
          msg += `   📊 ${gm.bet_count} apuestas | Casa: ${profit}\n`;
        });
        return message.reply(msg);
      }

      // /admin creditos — top 10 global por créditos
      if (sub === "creditos" || sub === "c") {
        const topGlobal = db.getTopCreditsGlobal(10);
        if (topGlobal.length === 0)
          return message.reply("💳 No hay jugadores con créditos todavía.");

        let msg = `💳 *Top Créditos — Global*\n\n`;
        topGlobal.forEach((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          msg += `${medal} ${u.username || 'Jugador'} _(${u.group_name})_: ${formatCredits(u.credits)}\n`;
        });
        return message.reply(msg);
      }

      // /admin creditos <groupId> — top 10 de un grupo específico
      if (sub === "grupo" || sub === "gp") {
        const targetId = parts[2];
        if (!targetId)
          return message.reply("❌ Uso: `/admin grupo <groupId>`\nPodés ver los IDs con `/admin grupos`.");

        const grpData = db.getGroup(targetId);
        if (!grpData)
          return message.reply("❌ Grupo no encontrado.");

        const topGroup = db.getTopCreditsByGroup(targetId, 10);
        if (topGroup.length === 0)
          return message.reply(`📊 No hay jugadores con créditos en *${grpData.group_name}*.`);

        let msg = `💳 *Top Créditos — ${grpData.group_name}*\n\n`;
        topGroup.forEach((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          msg += `${medal} ${u.username || 'Jugador'}: ${formatCredits(u.credits)}\n`;
        });
        return message.reply(msg);
      }

      // Menú de ayuda admin
      return message.reply(
        `🎰 *Panel Admin — Let It Ride*\n\n` +
        `▸ \`/admin resumen\` _(o r)_ — Estadísticas globales\n` +
        `▸ \`/admin grupos\` _(o g)_ — Desglose por grupo\n` +
        `▸ \`/admin top\` _(o t)_ — Mejores ganadores globales\n` +
        `▸ \`/admin partidas\` _(o p)_ — Últimas 10 partidas\n` +
        `▸ \`/admin creditos\` _(o c)_ — Top 10 créditos global\n` +
        `▸ \`/admin grupo <id>\` _(o gp)_ — Top 10 créditos de un grupo`
      );
    }

    return message.reply('❓ Comando no reconocido. Usá `/casino help`.');

  } catch (error) {
    console.error(`❌ Error en handleCommand (${message.body}):`, error);
    return message.reply("⚠️ Error procesando el comando. Intentalo de nuevo.");
  }
}

module.exports = { handleCommand, handlePollReaction, launchGame };