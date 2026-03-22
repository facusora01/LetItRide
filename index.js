require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const db = require("./database");
const { handleCommand, handlePollReaction, launchGame } = require("./commands");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const GAME_SCHEDULE = process.env.GAME_SCHEDULE || "20:00";
const GAME_DAYS = process.env.GAME_DAYS || "1,3,5";
const CREDIT_DAY = parseInt(process.env.CREDIT_DAY) || 5;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const creditDayName = DAY_NAMES[CREDIT_DAY];

// ─── CLIENTE WHATSAPP ─────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "letitride-casino-bot",
    dataPath: "../bot_session"
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor"
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

client.on("ready", () => {
  console.log("🎰 LetItRide Casino Bot listo y conectado a WhatsApp!\n");

  const groups = db.getActiveGroups();
  console.log(`📋 Grupos activos: ${groups.length}`);
  groups.forEach((g) => console.log(`   • ${g.group_name} (${g.group_id})`));
  console.log(`\n📅 Schedulers iniciados\n`);

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
});

// ─── LISTENER DE REACCIONES (para el poll de /casino start) ──────────────────
client.on("message_reaction", async (reaction) => {
  try {
    await handlePollReaction(reaction, client);
  } catch (err) {
    console.error("❌ Error en message_reaction:", err.message);
  }
});

// ─── HANDLER DE MENSAJES ──────────────────────────────────────────────────────
async function processMessage(message) {
  const body = message.body?.trim() || "";
  if (!body.startsWith("/") || body.length > 450) return;

  const from = message.from;

  try {
    if (!from.endsWith("@g.us") && !from.endsWith("@lid")) return;

    const lowerBody = body.toLowerCase();
    const validCommands = ["/casino", "/bet", "/balance", "/top", "/history", "/spin", "/stop", "/admin", "si", "sí", "yes", "no"];
    if (!validCommands.some(cmd => lowerBody.startsWith(cmd))) return;

    const logBody = body.length > 100 ? body.slice(0, 100) + "..." : body;
    console.log(`\n🎰 [${new Date().toLocaleTimeString("es-AR")}] ${from}: "${logBody}"`);

    await handleCommand(message, client);
  } catch (error) {
    console.error("❌ Error en processMessage:", error.message);
  }
}

client.on("message_create", processMessage);

client.on("disconnected", (reason) => {
  console.error("❌ Bot desconectado:", reason);
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