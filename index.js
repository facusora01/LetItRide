const startupTime = Math.floor(Date.now() / 1000);

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const db = require("./database");
const { handleCommand, handlePollReaction, handleBetReaction, launchGame, handleQuizCommand, handleQuizPollReaction } = require("./commands");
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
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    browser: process.env.BROWSER_TYPE || "chrome", // "firefox" o "chrome"
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",

      "--disable-dev-shm-usage",       // Usa /tmp en lugar de memoria compartida
      "--js-flags='--max-old-space-size=256'",  // Reducido de 512 a 256
      "--single-process",              // Corre todo en un solo hilo (ahorra CPU y RAM)
      "--no-zygote",                   // Evita procesos hijos pesados

      "--disable-accelerated-2d-canvas",
      "--disable-gpu",                 // No hay placa de video, no gastemos ciclos acá
      "--disable-extensions",          // Evita cargar plugins innecesarios
      "--disable-notifications",       // Evita alertas externas
      "--no-first-run",                // Salta configuraciones iniciales de Chrome

      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      
      "--proxy-server='direct://'",
      "--proxy-bypass-list=*",
      
      // Flags adicionales para reducir consumo
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees",
      "--disable-ipc-flooding-protection",
      "--enable-features=NetworkService,NetworkServiceInProcess"
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
  try {
    const page = client.pupPage;
    
    // Solo optimizar recursos si NO es Firefox (Chrome/Chromium sí lo soportan)
    if (process.env.BROWSER_TYPE !== 'firefox') {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const type = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          request.abort();
        } else {
          request.continue();
        }
      });
      console.log("⚡ Optimización de recursos activa: Imágenes y Estilos bloqueados.");
    } else {
      console.log("ℹ️  Optimización de recursos omitida (Firefox no soporta resourceType).");
    }
  } catch (e) {
    console.error("⚠️ No se pudo activar la optimización de Puppeteer:", e.message);
  }

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
client.on("message_reaction", async (reaction) => {
  // 1. Filtro Anti-Backlog: Ignorar reacciones de antes de prender el bot
  if (reaction.timestamp && reaction.timestamp < startupTime) return;

  // 2. Filtro Anti-Fantasmas: Ignorar cuando un usuario quita su reacción (llega vacío)
  if (!reaction.reaction || reaction.reaction.trim() === '') return;

  console.log(`🔔 REACTION EVENT 🔥`, JSON.stringify({
    emoji: reaction.reaction,
    sender: reaction.senderId,
    msgId: reaction.msgId?._serialized
  }));
  
  try {
    // 3. Procesa votaciones de inicio (/casino start), confirmaciones de regalos y apuestas
    await handlePollReaction(reaction, client);
    
    // 4. Procesa respuestas de quizzes (reacciones 1️⃣2️⃣3️⃣4️⃣)
    await handleQuizPollReaction(reaction, client);
    
    // NOTA: Borramos la llamada a handleBetReaction porque handlePollReaction 
    // ya se encarga de todo el flujo de apuestas correctamente.
  } catch (err) {
    console.error("❌ Error en message_reaction:", err.message);
  }
});


let isSynced = false; 
// ───── HANDLER DE MENSAJES ─────────────────────
async function processMessage(message) {
  // Filtro de mensajes antiguos (Backlog)
  if (message.timestamp < startupTime) return;

  if (!isSynced) {
    isSynced = true;
    console.log("\n" + "=".repeat(45));
    console.log("🚀 SISTEMA SINCRONIZADO: Leyendo chat en tiempo real");
    console.log(`📥 Primer mensaje recibido: "${message.body?.slice(0, 20)}..."`);
    console.log("=".repeat(45) + "\n");
  }

  const body = message.body?.trim() || "";

  if (!body.startsWith("/") || body.length > 450) return;

  const from = message.fromMe ? message.to : message.from;

  try {

    if (!from.endsWith("@g.us") && !from.endsWith("@lid")) return;

    const lowerBody = body.toLowerCase();
    const validCommands = ["/casino", "/letitride", "/bet", "/balance", "/top", "/history", "/stop", "/admin", "/spin", "/quiz"];
    if (!validCommands.some(cmd => lowerBody.startsWith(cmd))) return;

    db.updateGroupActivity(from); 

    const logBody = body.length > 100 ? body.slice(0, 100) + "..." : body;
    console.log(`\n🎰 [${new Date().toLocaleTimeString("es-AR")}] ${from}: "${logBody}"`);

    // Procesar comandos de quiz primero
    if (lowerBody.startsWith("/quiz")) {
      await handleQuizCommand(message, client);
      return;
    }

    // Procesar respuestas de quiz (A, B, C, D)
    if (/^[ABCD]$/.test(body.trim().toUpperCase())) {
      const isQuizAnswer = await processQuizAnswer(message, client);
      if (isQuizAnswer) return; // Si es respuesta de quiz, no procesar como comando normal
    }

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