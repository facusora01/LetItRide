require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const { exec } = require("child_process");
const db = require("./database");
const { handleCommand, handlePollReaction, launchGame } = require("./commands");
const { handleQuizCommand, handleQuizPollReaction } = require("./quizzes-new");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const GAME_SCHEDULE = process.env.GAME_SCHEDULE || "20:00";
const BET_DURATION = parseInt(process.env.BET_DURATION) || 4; // minutos de apuesta
const POLL_THRESHOLD = parseFloat(process.env.POLL_THRESHOLD) || 0.2; // % del grupo para votar (0.2 = 20%)
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

  // ─── CARGA SEMANAL DE CRÉDITOS ─────────────────────────────────────────
  cron.schedule(`0 0 * * ${CREDIT_DAY}`, () => {
    console.log(`🔄 Carga semanal de créditos (${creditDayName})`);
    db.getActiveGroups().forEach(group => {
      db.resetWeeklyCredits(group.group_id);
      client.sendMessage(group.group_id,
        `💰 *¡Créditos recargados!*\n\n` +
        `Todos los jugadores recibieron sus créditos del ${creditDayName}.\n\n` +
        `🎰 ¡Que comiencen los juegos! 🍀`
      );
    });
  }, { timezone: "America/Argentina/Buenos_Aires" });

  // ─── TAREA 1: AUTO-SALIR DE GRUPOS INACTIVOS (3:00 AM) ───────────────────
  cron.schedule("0 3 * * *", async () => {
    console.log("🧹 [3:00 AM] Iniciando limpieza de grupos inactivos...");
    try {
      const inactiveGroups = db.getInactiveGroups(2); 
      
      for (const group of inactiveGroups) {
        try {
          console.log(`👋 Saliendo del grupo inactivo: ${group.group_name} (${group.group_id})`);
          const chat = await client.getChatById(group.group_id);
          
          if (chat) {
            await chat.sendMessage("⚠️ *Aviso de inactividad* ⚠️\n\nComo no me han usado en 2 días, me retiro del grupo para ahorrar recursos del servidor.\n\n¡Nos vemos! 👋🎰");
            await chat.leave();
          }
          db.removeGroup(group.group_id); 
        } catch (error) {
          console.error(`❌ Error al salir del grupo ${group.group_id}:`, error.message);
          db.removeGroup(group.group_id);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      console.log("✅ Limpieza de grupos terminada.");
    } catch (err) {
      console.error("❌ Error en el cron de inactividad:", err.message);
    }
  }, { timezone: "America/Argentina/Buenos_Aires" });

  // ─── TAREA 2: BACKUP AUTOMÁTICO A GITHUB/GITLAB (4:00 AM) ────────────────
  cron.schedule("0 4 * * *", () => {
    console.log("💾 [4:00 AM] Iniciando backup automático a la rama 'Backups'...");
    const cmd = `git add . && git commit -m "Auto-backup $(date +'%Y-%m-%d %H:%M')" || echo "Sin cambios para commitear" && git push origin HEAD:Backups -f`;
    exec(cmd, (error, stdout, stderr) => {
      if (error && !error.message.includes('Sin cambios')) {
        console.warn(`⚠️ Advertencia de Git: ${error.message}`);
      }
      if (stderr && !stderr.includes('Everything up-to-date')) {
        console.log(`ℹ️ Info Git: ${stderr}`);
      }
      console.log(`✅ Backup completado: ${stdout.trim() || 'Rama actualizada.'}`);
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

// ─── LISTENER DE REACCIONES (para el poll de /casino start y quizzes) ────────
client.on("message_reaction", async (reaction) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout procesando reacción")), 5000)
  );
  try {
    // 👈 ACÁ AGREGAMOS handleQuizPollReaction
    await Promise.race([
      handlePollReaction(reaction, client),
      handleQuizPollReaction(reaction, client), 
      timeout
    ]);
  } catch (err) {
    console.error("❌ Error en message_reaction:", err.message);
  }
});

// ─── HANDLER DE MENSAJES ──────────────────────────────────────────────────────
async function processMessage(message) {
  const body = message.body?.trim() || "";
  if (!body.startsWith("/") || body.length > 450) return;

  const from = message.fromMe ? message.to : message.from;

  try {
    if (!from.endsWith("@g.us") && !from.endsWith("@lid")) return;

    const lowerBody = body.toLowerCase();
    // 👈 ACÁ AGREGAMOS "/quiz" A LA LISTA
    const validCommands = ["/casino", "/letitride", "/bet", "/balance", "/top", "/history", "/stop", "/admin", "/quiz"];
    if (!validCommands.some(cmd => lowerBody.startsWith(cmd))) return;

    const logBody = body.length > 100 ? body.slice(0, 100) + "..." : body;
    console.log(`\n🎰 [${new Date().toLocaleTimeString("es-AR")}] ${from}: "${logBody}"`);

    // 👈 ACÁ SEPARAMOS LA LÓGICA
    if (lowerBody.startsWith("/quiz")) {
      await handleQuizCommand(message, client);
    } else {
      await handleCommand(message, client);
    }
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