const startupTime = Math.floor(Date.now() / 1000);

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const db = require("./database");
const { handleCommand, handlePollReaction, launchGame, handleQuizPollReaction, handleBetReaction, handleQuizCommand } = require("./commands");
const { handleQuizPollVote } = require("./quizzes.js");
const { processQuizAnswer } = require("./quizzes-new");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const GAME_SCHEDULE = process.env.GAME_SCHEDULE || "20:00";
const BET_DURATION = parseInt(process.env.BET_DURATION) || 4; // minutos de apuesta
const POLL_THRESHOLD = parseFloat(process.env.POLL_THRESHOLD) || 0.2; // % del grupo para votar (0.2 = 20%)
const GAME_DAYS = process.env.GAME_DAYS || "1,3,5";
const CREDIT_DAY = parseInt(process.env.CREDIT_DAY) || 5;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const creditDayName = DAY_NAMES[CREDIT_DAY];

// Quizzes: solo activación manual por /quiz start (superadmin)
console.log("🧠 Quizzes: modo manual activado");

// ─── CLIENTE WHATSAPP ─────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "letitride-casino-bot",
    dataPath: "./casino_session"
  }),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    browser: process.env.BROWSER_TYPE || "chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disk-cache-size=0" // Evita que Chrome sature el disco de tu VPS
    ],
  },
});

// ─── EVENTOS DE CONEXIÓN ──────────────────────────────────────────────────────
client.on("qr", (qr) => {
  console.clear();
  console.log("==========================================");
  console.log(`🕒 [${new Date().toLocaleTimeString()}] NUEVO QR DETECTADO`);
  console.log("📱 Escanealo rápido, el código expira pronto.");
  console.log("==========================================\n");
  qrcode.generate(qr, { small: true });
  console.log("\n⏳ Si el QR no carga o se corta, esperá 20 segundos...");
});

client.on("authenticated", () => console.log("✅ Autenticado correctamente."));
client.on("auth_failure", (msg) => console.error("❌ Error de autenticación:", msg));

client.on("ready", async () => {
  // Se eliminó la optimización de recursos (setRequestInterception) 
  // porque generaba mucha latencia en la lectura de los mensajes.

  console.log("🎰 LetItRide Casino Bot listo y conectado a WhatsApp!\n");

  const groups = db.getActiveGroups();
  console.log(`📋 Grupos activos: ${groups.length}`);
  groups.forEach((g) => console.log(`   • ${g.group_name} (${g.group_id})`));
  console.log(`\n📅 Schedulers iniciados\n`);

  // ─── LIMPIEZA AUTOMÁTICA (3 DÍAS DE INACTIVIDAD) ─────────────────────────
  cron.schedule("0 3 * * *", async () => {
    console.log("🧹 Iniciando chequeo de inactividad...");
    const inactiveGroups = db.getInactiveGroups(3); 
    
    for (const group of inactiveGroups) {
      try {
        const chat = await client.getChatById(group.group_id);
        await client.sendMessage(group.group_id, 
          "👋 *Aviso de inactividad:*\n\n" +
          "Este casino se retira del grupo debido a que no hubo actividad en los últimos 3 días. " +
          "¡Vuelvan a invitarme cuando quieran jugar! 🎰"
        );
        await chat.leave();
        db.removeGroup(group.group_id);
        console.log(`🚪 Salida automática: ${group.group_name} por inactividad.`);
      } catch (err) {
        console.error(`❌ Error al salir del grupo ${group.group_id}:`, err.message);
      }
    }
  }, { timezone: "America/Argentina/Buenos_Aires" });

  // ─── RESETEO SEMANAL DE CRÉDITOS ─────────────────────────────────────────
  cron.schedule(`0 0 * * ${CREDIT_DAY}`, () => {
    console.log(`🔄 Reseteo semanal de créditos (${creditDayName})`);
    db.getActiveGroups().forEach(group => {
      db.resetWeeklyCredits(group.group_id);
      client.sendMessage(group.group_id,
        `💰 *¡Créditos recargados!*\n\n` +
        `Todos los jugadores recibieron sus créditos del ${creditDayName}.\n\n` +
        `🎰 ¡Que comiencen los juegos! 🍀`
      );
    });
  }, { timezone: "America/Argentina/Buenos_Aires" });

  // ─── JUEGO AUTOMÁTICO ────────────────────────────────────────────────────
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.toLocaleTimeString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "2-digit", minute: "2-digit", hour12: false
    });

    for (const group of db.getActiveGroups()) {
      const settings = db.getGroupSettings(group.group_id);
      if (!settings) continue;

      const gameDays = (settings.game_days || GAME_DAYS).split(',').map(d => parseInt(d.trim()));
      const gameSchedule = settings.game_schedule || GAME_SCHEDULE;

      if (gameDays.includes(currentDay) && currentTime === gameSchedule) {
        if (!db.getActiveGame(group.group_id)) {
          console.log(`🎰 Juego automático iniciando para ${group.group_name}`);
          await client.sendMessage(group.group_id,
            `🎰 *¡JUEGO AUTOMÁTICO!* 🎲\n\nLa partida programada de las ${gameSchedule} arranca ahora.`
          );
          await launchGame(client, group.group_id, group.group_name);
        }
      }
    }
  }, { timezone: "America/Argentina/Buenos_Aires" });

  // Los quizzes se activan SOLO por comando /quiz start (superadmin)
  console.log("🧠 Quizzes: activación manual únicamente (/quiz start)");
});

// ─── LISTENER DE REACCIONES (para el poll de /casino start y quizzes) ──────────────────

const ALLOWED_REACTIONS = ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿', '1️⃣', '2️⃣', '3️⃣', '4️⃣'];

// ─── LISTENER DE REACCIONES ────────────────────────────────────────────────────
client.on("message_reaction", async (reaction) => {
  // 1. Filtro Anti-Fantasmas
  if (!reaction.reaction || reaction.reaction.trim() === '') return;

  // 2. ⚡ FILTRO INTELIGENTE DE EMOJIS (A prueba de Android/iOS)
  const emoji = reaction.reaction;
  const isValidReaction = ALLOWED_REACTIONS.includes(emoji);
  
  if (!isValidReaction) return;

  // Logueamos para que veas en consola que sí te reconoció
  let sender = reaction.senderId || "Dueño/Bot";
  const isFromBot = reaction.fromMe || sender.includes("Bot") || sender === client.info.wid._serialized;
  console.log(`🔔 REACTION EVENT 🔥 | Emoji: ${emoji} | De: ${sender} ${isFromBot ? '(BOT)' : '(Usuario)'}`);
  
  try {
    await handlePollReaction(reaction, client);
    // Solo procesar reacciones de quiz si son emojis numéricos [1️⃣,2️⃣,3️⃣,4️⃣]
    const isQuizEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '1⃣', '2⃣', '3⃣', '4⃣'].includes(emoji);
    if (isQuizEmoji) {
      await handleQuizPollReaction(reaction, client);
    }
  } catch (err) {
    console.error("❌ Error en message_reaction:", err.message);
  }
});

// ─── VOTOS DE POLL (quiz y votaciones nativas de WhatsApp) ────────────────────
client.on("message_create", async (msg) => {
  if (msg.type !== "poll_vote") return;
  try {
    await handleQuizPollVote(msg, client);
  } catch (err) {
    console.error("❌ Error en poll_vote:", err.message);
  }
});


let isSynced = false; 
const processedMessages = new Set(); // Memoria a corto plazo para evitar duplicados

// ───── HANDLER DE MENSAJES ─────────────────────
async function processMessage(message) {
  // 1. Filtro de mensajes antiguos (Backlog)
  if (message.timestamp < startupTime) return;

  // 2. (Bloquea lecturas repetidas del mismo mensaje)
  const msgId = message.id?._serialized;
  if (msgId) {
    if (processedMessages.has(msgId)) return; // Si ya lo leímos, chau
    processedMessages.add(msgId);
    // Borramos el ID de la memoria después de 30 segundos para no gastar RAM
    setTimeout(() => processedMessages.delete(msgId), 30000);
  }

  const body = message.body?.trim() || "";

  // 3. Si no empieza con "/" y no es una letra suelta (A,B,C,D), lo descartamos
  const isQuizAnswer = /^[ABCD]$/i.test(body);
  if (!body.startsWith("/") && !isQuizAnswer) return;

  // 4. Chequeo de tamaño
  if (body.length > 450) return;

  // 4. Identificamos de dónde viene y filtramos si no es de un grupo
  const from = message.fromMe ? message.to : message.from;
  if (!from.endsWith("@g.us") && !from.endsWith("@lid")) return;

  // 5. Recién ahora marcamos que el sistema está sincronizado (Solo se activa con el primer comando válido)
  if (!isSynced) {
    isSynced = true;
    console.log("\n" + "=".repeat(45));
    console.log("🚀 SISTEMA SINCRONIZADO: Leyendo chat en tiempo real");
    console.log(`📥 Primer mensaje útil recibido: "${body.slice(0, 20)}..."`);
    console.log("=".repeat(45) + "\n");
  }

  try {
    const lowerBody = body.toLowerCase();
    
    // 6. Validamos que sea un comando conocido (Si no es una respuesta de quiz)
    if (!isQuizAnswer) {
      const validCommands = ["/casino", "/letitride", "/bet", "/balance", "/top", "/history", "/stop", "/admin", "/spin", "/quiz"];
      if (!validCommands.some(cmd => lowerBody.startsWith(cmd))) return;
    }

    db.updateGroupActivity(from); 

    const logBody = body.length > 100 ? body.slice(0, 100) + "..." : body;
    console.log(`\n🎰 [${new Date().toLocaleTimeString("es-AR")}] ${from}: "${logBody}"`);

    // Procesar comandos de quiz primero
    if (lowerBody.startsWith("/quiz")) {
      await handleQuizCommand(message, client);
      return;
    }

    // Procesar respuestas de quiz (A, B, C, D)
    if (isQuizAnswer) {
      const processed = await processQuizAnswer(message, client);
      if (processed) return; // Si era respuesta válida de quiz, cortamos acá
    }

    // Procesar el resto de los comandos normales (/bet, /balance, etc)
    await handleCommand(message, client);
    
  } catch (error) {
    // Ignorar errores de Chrome/Puppeteer que son temporales
    if (error.message.includes("Target closed") || 
        error.message.includes("Protocol error") || 
        error.message.includes("Session closed")) {
      console.log("⚠️ Error temporal de Chrome/Puppeteer - ignorando");
      return;
    }
    console.error("❌ Error en processMessage:", error.message);
  }
}

client.on("message_create", async (msg) => {
  processMessage(msg).catch(err => {
    // Ignorar errores temporales de Chrome/Puppeteer
    if (err.message.includes("Target closed") || 
        err.message.includes("Protocol error") || 
        err.message.includes("Session closed")) {
      console.log("⚠️ Error temporal en message_create - ignorando");
      return;
    }
    console.error("❌ Error asíncrono en processMessage:", err.message);
  });
});

// ─── MONITOREO DE SALUD DEL NAVEGADOR ───────────────────────────────────
client.on("disconnected", (reason) => {
    console.error("🚨 Bot desconectado del socket:", reason);

    process.exit(1); 
});

client.pupPage?.on('error', (err) => {
    console.error("🔥 Error crítico en la página de Puppeteer:", err.message);
    process.exit(1); 
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || "";
  if (msg.includes('Execution context was destroyed')) {
    console.warn('⚠️ Contexto de Puppeteer destruido (ignorado).');
    return;
  }
  console.error('🚨 Error no manejado:', reason);
});

// ─── INICIO CON REINTENTOS ────────────────────────────────────────────────────
console.log("🚀 Iniciando LetItRide Casino Bot...");

async function startBot(intentos = 3, demora = 8000) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await client.initialize();
      return;
    } catch (err) {
      const esContexto = err.message?.includes('Execution context was destroyed');
      if (esContexto && i < intentos) {
        console.warn(`⚠️ Error de contexto en intento ${i}/${intentos}. Reintentando en ${demora / 1000}s...`);
        await new Promise(r => setTimeout(r, demora));
      } else {
        console.error(`❌ Error fatal en initialize() (intento ${i}/${intentos}):`, err.message);
        process.exit(1);
      }
    }
  }
}

startBot();
