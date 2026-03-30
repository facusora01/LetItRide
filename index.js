const startupTime = Math.floor(Date.now() / 1000);

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const db = require("./database");
const { handleCommand, handlePollReaction, handleBetReaction, launchGame } = require("./commands");
const { handleQuizCommand, processQuizAnswer, createRandomQuiz, finishQuiz, handleQuizPollReaction, handleQuizPollVote } = require("./quizzes-new");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const GAME_SCHEDULE = process.env.GAME_SCHEDULE || "20:00";
const BET_DURATION = parseInt(process.env.BET_DURATION) || 4; // minutos de apuesta
const POLL_THRESHOLD = parseFloat(process.env.POLL_THRESHOLD) || 0.2; // % del grupo para votar (0.2 = 20%)
const GAME_DAYS = process.env.GAME_DAYS || "1,3,5";
const CREDIT_DAY = parseInt(process.env.CREDIT_DAY) || 5;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const creditDayName = DAY_NAMES[CREDIT_DAY];

// Configuración de Quizzes Automáticos
const QUIZ_ENABLED = process.env.QUIZ_ENABLED === "true";
const QUIZ_DAILY_COUNT = parseInt(process.env.QUIZ_DAILY_COUNT) || 3;
const QUIZ_DAYS = process.env.QUIZ_DAYS || "1,2,3,4,5"; // Lunes a Viernes por defecto
const QUIZ_START_HOUR = parseInt(process.env.QUIZ_START_HOUR) || 10;
const QUIZ_END_HOUR = parseInt(process.env.QUIZ_END_HOUR) || 22;
const QUIZ_TIME_LIMIT = parseInt(process.env.QUIZ_TIME_LIMIT) || 10; // Tiempo límite en segundos

// Configuración de API de Quizzes
const QUIZ_API_ENABLED = process.env.QUIZ_API_ENABLED === "true";
const QUIZ_API_URL = process.env.QUIZ_API_URL || "https://opentdb.com/api.php";
const QUIZ_API_TIMEOUT = parseInt(process.env.QUIZ_API_TIMEOUT) || 5000;
const QUIZ_API_FALLBACK = process.env.QUIZ_API_FALLBACK !== "false";

// Debug: mostrar configuración de quizzes
console.log(`🧠 Configuración Quizzes: ${QUIZ_ENABLED ? 'ACTIVADO' : 'DESACTIVADO'}`);
if (QUIZ_ENABLED) {
  console.log(`   • Quizzes por día: ${QUIZ_DAILY_COUNT}`);
  console.log(`   • Días: ${QUIZ_DAYS}`);
  console.log(`   • Horario: ${QUIZ_START_HOUR}:00 - ${QUIZ_END_HOUR}:00`);
  console.log(`   • Tiempo límite: ${QUIZ_TIME_LIMIT} segundos`);
  console.log(`   • API Externa: ${QUIZ_API_ENABLED ? 'ACTIVADA' : 'DESACTIVADA'}`);
  if (QUIZ_API_ENABLED) {
    console.log(`   • URL API: ${QUIZ_API_URL}`);
    console.log(`   • Timeout: ${QUIZ_API_TIMEOUT}ms`);
    console.log(`   • Fallback local: ${QUIZ_API_FALLBACK ? 'SÍ' : 'NO'}`);
  }
}

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

  // ─── QUIZZES AUTOMÁTICOS ───────────────────────────────────────────────────────
  if (QUIZ_ENABLED) {
    console.log("🧠 Sistema de quizzes automáticos activado");
    
    // Scheduler para quizzes aleatorios - se ejecuta cada hora para verificar si toca un quiz
    cron.schedule("0 * * * *", async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();
      
      // Verificar si es día de quiz y está en el rango horario
      const quizDays = QUIZ_DAYS.split(',').map(d => parseInt(d.trim()));
      if (!quizDays.includes(currentDay) || currentHour < QUIZ_START_HOUR || currentHour > QUIZ_END_HOUR) {
        return;
      }
      
      // Verificar cuántos quizzes se han hecho hoy
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      
      for (const group of db.getActiveGroups()) {
        try {
          // Contar quizzes de hoy para este grupo
          const todayQuizzes = db.getQuizHistory(group.group_id)
            .filter(q => new Date(q.created_at) >= todayStart && new Date(q.created_at) <= todayEnd)
            .length;
          
          // Probabilidad de iniciar quiz (basado en cuántos faltan y horas restantes)
          const remainingQuizzes = QUIZ_DAILY_COUNT - todayQuizzes;
          const remainingHours = QUIZ_END_HOUR - currentHour;
          
          if (remainingQuizzes > 0 && remainingHours > 0) {
            const probability = remainingQuizzes / remainingHours;
            const shouldStartQuiz = Math.random() < probability;
            
            if (shouldStartQuiz && todayQuizzes < QUIZ_DAILY_COUNT) {
              console.log(`🧠 Quiz automático iniciando para ${group.group_name} (${todayQuizzes + 1}/${QUIZ_DAILY_COUNT})`);
              
              // Seleccionar dificultad aleatoria
              const difficulties = ['easy', 'normal', 'hard'];
              const weights = [0.4, 0.4, 0.2]; // 40% fácil, 40% normal, 20% difícil
              const random = Math.random();
              let difficulty = 'normal';
              
              let cumulative = 0;
              for (let i = 0; i < difficulties.length; i++) {
                cumulative += weights[i];
                if (random <= cumulative) {
                  difficulty = difficulties[i];
                  break;
                }
              }
              
              await client.sendMessage(group.group_id,
                `🧠 *QUIZ AUTOMÁTICO* 🎯\n\n` +
                `🎲 *Dificultad:* ${difficulty === 'easy' ? '🟢 Fácil' : difficulty === 'normal' ? '🟡 Normal' : '🔴 Difícil'}\n` +
                `⏰ ¡Arranca ahora! Responde rápido con A, B, C o D.`
              );
              
              // Crear y ejecutar quiz
              const quizData = await createRandomQuiz(group.group_id, difficulty);
              if (quizData) {
                const { formatQuizMessage, createPollOptions } = require("./quizzes-new");
                const quizMessage = formatQuizMessage(quizData.quiz);
                const pollOptions = createPollOptions(quizData.quiz);
                
                try {
                  // Enviar como poll
                  const pollMessage = await client.sendMessage(group.group_id, quizMessage, {
                    poll: {
                      name: quizData.quiz.question,
                      options: pollOptions,
                      allowMultipleAnswers: false
                    }
                  });
                  
                  // Guardar el ID del mensaje del poll
                  quizData.pollMessageId = pollMessage.id._serialized;
                  
                } catch (error) {
                  console.error("Error creando poll automático:", error.message);
                  
                  // Fallback: enviar mensaje normal
                  const fallbackMessage = quizMessage + "\n\n" + pollOptions.join("\n");
                  await client.sendMessage(group.group_id, fallbackMessage);
                }
                
                // Auto-terminar después del tiempo límite
                setTimeout(async () => {
                  await finishQuiz(group.group_id, client);
                }, quizData.timeLimit);
              }
            }
          }
        } catch (error) {
          console.error(`Error en quiz automático para ${group.group_name}:`, error.message);
        }
      }
    }, { timezone: "America/Argentina/Buenos_Aires" });
  }
});

// ─── LISTENER DE REACCIONES (para el poll de /casino start y quizzes) ──────────────────
client.on("message_reaction", async (reaction) => {
  try {
    // 1. Procesa votaciones de inicio (/casino start)
    await handlePollReaction(reaction, client);
    
    // 2. Procesa respuestas de polls de quizzes
    await handleQuizPollReaction(reaction, client);
    
    // 3. Procesa votaciones de inicio de quizzes
    await handleQuizPollVote(reaction, client);
    
    // 4. Procesa confirmaciones de apuestas y regalos
    const reactorId = reaction.senderId; 
    await handleBetReaction(client, reaction, reactorId); 
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

client.on("message_create", (message) => {

  processMessage(message).catch(err => {
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