const db = require("./database");
const { 
  getRandomQuiz, 
  createQuiz, 
  createRandomQuiz, 
  getActiveQuiz, 
  endQuiz, 
  submitAnswer, 
  formatQuizMessage, 
  createPollOptions,
  getQuizStats,
  QUIZ_PRIZES 
} = require("./quiz-manager");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SUPER_ADMINS = ["5491100000000", "541100000000", "100000000000000"];
const QUIZ_THRESHOLD = parseFloat(process.env.QUIZ_THRESHOLD) || 0.05; // 5% del grupo
const QUIZ_TIME_LIMIT = 15000; // 15 segundos fijos

// Mapa de emojis a índices de respuesta
const EMOJI_TO_INDEX = {
  '1️⃣': 0, '1': 0,
  '2️⃣': 1, '2': 1, 
  '3️⃣': 2, '3': 2,
  '4️⃣': 3, '4': 3
};

const INDEX_TO_LETTER = ['A', 'B', 'C', 'D'];

// ─── POLLS DE VOTACIÓN ACTIVOS ───────────────────────────────────────────────────
const activeQuizPolls = new Map(); // groupId -> pollData

// ─── FUNCIONES DE ADMIN ─────────────────────────────────────────────────────────
async function isQuizAdmin(message, client) {
  try {
    let rawSenderId = message.author || message.from;
    if (rawSenderId && rawSenderId.includes('@lid')) {
      try {
        const contact = await message.getContact();
        if (contact && contact.number) rawSenderId = contact.number + '@c.us';
      } catch (e) {}
    }
    const number = rawSenderId.split('@')[0].split(':')[0];
    
    // Super Admins siempre tienen acceso
    if (SUPER_ADMINS.includes(number)) return true;
    
    // Verificar si es admin del grupo
    try {
      const chat = await message.getChat();
      if (chat.isGroup) {
        const participant = chat.participants.find(p => p.id._serialized === rawSenderId);
        return participant && (participant.isAdmin || participant.isSuperAdmin);
      }
    } catch (e) {}
    
    return false;
  } catch (error) {
    console.error("Error verificando admin de quiz:", error);
    return false;
  }
}

// ─── COMANDOS DE QUIZ ───────────────────────────────────────────────────────────
async function handleQuizCommand(message, client) {
  const body = message.body.trim().toLowerCase();
  const from = message.fromMe ? message.to : message.from;
  const senderId = message.author || message.from;
  
  const parts = body.split(' ');
  const command = parts[1]; // start, stop, help
  
  switch (command) {
    case 'start':
      await handleQuizStart(message, client, parts);
      break;
    case 'stop':
      await handleQuizStop(message, client);
      break;
    case 'stats':
      await handleQuizStats(message, client);
      break;
    case 'help':
      await handleQuizHelp(message, client);
      break;
    default:
      await handleQuizHelp(message, client);
  }
}

async function handleQuizStart(message, client, parts) {
  const from = message.fromMe ? message.to : message.from;
  const senderId = message.author || message.from;
  
  // Verificar si ya hay un quiz activo
  if (getActiveQuiz(from)) {
    await client.sendMessage(from, 
      "⚠️ *Ya hay un quiz activo en este grupo.*\n\n" +
      "Espera a que termine o usa `/quiz stop` para cancelarlo."
    );
    return;
  }
  
  // Verificar si hay un poll de votación activo
  if (activeQuizPolls.has(from)) {
    await client.sendMessage(from, 
      "⚠️ *Ya hay una votación para quiz activa.*\n\n" +
      "Espera a que termine la votación actual."
    );
    return;
  }
  
  // Determinar dificultad
  let difficulty = 'normal'; // por defecto
  if (parts.length > 2) {
    const requestedDifficulty = parts[2].toLowerCase();
    if (['easy', 'facil', 'fácil'].includes(requestedDifficulty)) {
      difficulty = 'easy';
    } else if (['hard', 'dificil', 'difícil'].includes(requestedDifficulty)) {
      difficulty = 'hard';
    }
  }
  
  // Verificar si es admin
  const isAdmin = await isQuizAdmin(message, client);
  
  if (isAdmin) {
    // Admin: iniciar quiz directamente
    console.log(`🧠 Quiz iniciado por admin: ${senderId} en ${from}`);
    await startQuizDirectly(from, difficulty, client);
  } else {
    // No admin: iniciar votación
    console.log(`🗳️ Iniciando votación para quiz: ${senderId} en ${from}`);
    await startQuizPoll(from, difficulty, message, client);
  }
}

async function startQuizDirectly(groupId, difficulty, client) {
  try {
    // Cancelar cualquier votación existente
    if (activeQuizPolls.has(groupId)) {
      const pollData = activeQuizPolls.get(groupId);
      try {
        await client.sendMessage(groupId, "🛑 *Votación cancelada:* Un admin inició el quiz directamente.");
        // Intentar eliminar el poll
        if (pollData.pollMessageId) {
          const pollMessage = await client.getMessageById(pollData.pollMessageId);
          if (pollMessage) await pollMessage.delete();
        }
      } catch (e) {}
      activeQuizPolls.delete(groupId);
    }
    
    // Crear quiz directamente
    const quizData = await createQuiz(groupId, difficulty);
    if (!quizData) {
      await client.sendMessage(groupId, "❌ *Error:* No se pudo crear el quiz. Intenta más tarde.");
      return;
    }
    
    // Enviar mensaje del quiz con instrucciones de reacción
    const quizMessage = formatQuizMessage(quizData.quiz);
    const options = createPollOptions(quizData.quiz);
    
    const fullMessage = quizMessage + 
      `\n\n🎯 *OPCIONES:*\n` +
      options.map((opt, i) => `${['1️⃣','2️⃣','3️⃣','4️⃣'][i]} ${opt}`).join('\n') +
      `\n\n⏱️ *Tienes 15 segundos para reaccionar con 1️⃣, 2️⃣, 3️⃣ o 4️⃣*\n` +
      `👆 *Reaccioná al mensaje con el emoji de tu respuesta!*`;
    
    try {
      const msg = await client.sendMessage(groupId, fullMessage);
      
      // Guardar el ID del mensaje para detectar reacciones
      quizData.quizMessageId = msg.id._serialized;
      
      console.log(`🧠 Quiz enviado: ${quizData.quizMessageId} (15s límite)`);
      
    } catch (error) {
      console.error("Error enviando quiz:", error.message);
    }
    
    // Configurar timeout para terminar el quiz automáticamente (15 segundos)
    setTimeout(async () => {
      const activeQuiz = getActiveQuiz(groupId);
      if (activeQuiz && activeQuiz.status === 'active') {
        await finishQuiz(groupId, client);
      }
    }, QUIZ_TIME_LIMIT);
    
  } catch (error) {
    console.error("Error en startQuizDirectly:", error);
    await client.sendMessage(groupId, "❌ *Error:* No se pudo iniciar el quiz. Intenta más tarde.");
  }
}

async function startQuizPoll(groupId, difficulty, message, client) {
  try {
    // Obtener información del grupo
    const chat = await client.getChatById(groupId);
    const participantCount = chat.participants.length;
    const requiredVotes = Math.ceil(participantCount * QUIZ_THRESHOLD);
    
    // Crear mensaje de votación
    const emoji = difficulty === 'easy' ? '🟢' : difficulty === 'normal' ? '🟡' : '🔴';
    const prize = QUIZ_PRIZES[difficulty];
    
    await client.sendMessage(groupId, 
      `🧠 *SOLICITUD DE QUIZ* 🗳️\n\n` +
      `${emoji} *Dificultad:* ${difficulty === 'easy' ? 'Fácil' : difficulty === 'normal' ? 'Normal' : 'Difícil'}\n` +
      `💰 *Premio total:* ${prize.toLocaleString()} créditos\n` +
      `⏱️ *Tiempo límite:* 15 segundos\n\n` +
      `📊 *Votación requerida:* ${requiredVotes} votos (${Math.round(QUIZ_THRESHOLD * 100)}% del grupo)\n\n` +
      `👇 *Reaccioná con 1️⃣ para votar SÍ* (ignorar = NO)`
    );
    
    // Guardar datos de la votación
    const pollData = {
      groupId,
      difficulty,
      requiredVotes,
      votes: new Set(), // userIds que votaron sí
      startTime: Date.now(),
      timeout: 60000 // 1 minuto para votar
    };
    
    activeQuizPolls.set(groupId, pollData);
    
    // Configurar timeout para terminar la votación
    setTimeout(async () => {
      await finishQuizPoll(groupId, client);
    }, pollData.timeout);
    
    console.log(`🗳️ Poll de quiz creado: ${pollMessage.id._serialized} (requiere ${requiredVotes} votos)`);
    
  } catch (error) {
    console.error("Error en startQuizPoll:", error);
    await client.sendMessage(groupId, "❌ *Error:* No se pudo iniciar la votación. Intenta más tarde.");
  }
}

async function finishQuizPoll(groupId, client) {
  const pollData = activeQuizPolls.get(groupId);
  if (!pollData) return;
  
  try {
    const yesVotes = pollData.votes.size;
    const totalVotes = yesVotes; // Solo contamos los sí
    
    activeQuizPolls.delete(groupId);
    
    if (yesVotes >= pollData.requiredVotes) {
      // Votación aprobada - iniciar quiz
      await client.sendMessage(groupId, 
      `🎉 *¡VOTACIÓN APROBADA!* 🎉\n\n` +
      `📊 *Resultados:* ${yesVotes}/${totalVotes} votos\n` +
      `✅ *Umbral alcanzado:* ${pollData.requiredVotes} votos\n\n` +
      `🧠 *Iniciando quiz ${pollData.difficulty} ahora...*`
    );
      
      await startQuizDirectly(groupId, pollData.difficulty, client);
    } else {
      // Votación rechazada
      await client.sendMessage(groupId, 
      `❌ *VOTACIÓN RECHAZADA* ❌\n\n` +
      `📊 *Resultados:* ${yesVotes}/${totalVotes} votos\n` +
      `❌ *Umbral no alcanzado:* Se necesitaban ${pollData.requiredVotes} votos\n` +
      `💡 *Pueden solicitar otro quiz más tarde*`
    );
    }
    
  } catch (error) {
    console.error("Error en finishQuizPoll:", error);
    await client.sendMessage(groupId, "❌ *Error:* No se pudo procesar la votación.");
  }
}

async function handleQuizStop(message, client) {
  const from = message.fromMe ? message.to : message.from;
  const senderId = message.author || message.from;
  
  const isAdmin = await isQuizAdmin(message, client);
  if (!isAdmin) {
    await client.sendMessage(from, "⚠️ *Solo los administradores pueden detener quizzes.*");
    return;
  }
  
  const quizData = getActiveQuiz(from);
  if (!quizData) {
    await client.sendMessage(from, "⚠️ *No hay ningún quiz activo en este grupo.*");
    return;
  }
  
  await finishQuiz(from, client);
}

async function handleQuizStats(message, client) {
  const from = message.fromMe ? message.to : message.from;
  const stats = getQuizStats();
  
  let statsMessage = `📊 *ESTADÍSTICAS DE QUIZZES* 📊\n\n`;
  
  statsMessage += `📚 *Banco Local:*\n`;
  statsMessage += `   • Fáciles: ${stats.local.easy}\n`;
  statsMessage += `   • Normales: ${stats.local.normal}\n`;
  statsMessage += `   • Difíciles: ${stats.local.hard}\n`;
  statsMessage += `   • Total: ${stats.local.total}\n\n`;
  
  statsMessage += `🌐 *API Externa:*\n`;
  statsMessage += `   • Estado: ${stats.api.enabled ? '✅ Activada' : '❌ Desactivada'}\n`;
  statsMessage += `   • URL: ${stats.api.url}\n`;
  statsMessage += `   • Timeout: ${stats.api.timeout}ms\n`;
  statsMessage += `   • Fallback: ${stats.api.fallback ? '✅' : '❌'}\n\n`;
  
  statsMessage += `🎯 *Activos:*\n`;
  statsMessage += `   • Quizzes en curso: ${stats.active}\n\n`;
  
  statsMessage += `💰 *Premios:*\n`;
  statsMessage += `   • Fácil: ${QUIZ_PRIZES.easy.toLocaleString()} créditos\n`;
  statsMessage += `   • Normal: ${QUIZ_PRIZES.normal.toLocaleString()} créditos\n`;
  statsMessage += `   • Difícil: ${QUIZ_PRIZES.hard.toLocaleString()} créditos`;
  
  await client.sendMessage(from, statsMessage);
}

async function handleQuizHelp(message, client) {
  const from = message.fromMe ? message.to : message.from;
  const isAdmin = await isQuizAdmin(message, client);
  
  const helpMessage = `🎯 *COMANDOS DE QUIZ* 🎯

📝 *Comandos disponibles:*
▸ \`/quiz start\` — Inicia quiz normal (🟡 100,000 créditos)
▸ \`/quiz start easy\` — Quiz fácil (🟢 50,000 créditos)  
▸ \`/quiz start hard\` — Quiz difícil (🔴 200,000 créditos)
▸ \`/quiz stop\` — Detiene el quiz actual ${isAdmin ? '(Solo admins)' : '(🔒 Solo admins)'}
▸ \`/quiz stats\` — Muestra estadísticas del sistema
▸ \`/quiz help\` — Muestra esta ayuda

🎮 *Cómo funciona:*
${isAdmin ? '• Como admin, inicias quizzes directamente' : '• Los usuarios solicitan quizzes mediante votación'}
Se necesita ${Math.round(QUIZ_THRESHOLD * 100)}% del grupo para aprobar
Una vez aprobado, tienes *15 segundos* para responder
Reaccioná con 1️⃣, 2️⃣, 3️⃣ o 4️⃣ al mensaje del quiz
El premio se divide entre todos los que acierten

💡 *Sistema de votación:*
• 👤 *Usuarios no-admins:* Reaccionan con 1️⃣ para votar SÍ
• 👑 *Admins:* Inician quiz directamente (cancela votaciones activas)
• ⏱️ *Votación dura:* 1 minuto
• 🎯 *Umbral:* ${Math.round(QUIZ_THRESHOLD * 100)}% de los miembros

⚙️ *Configuración:*
• Tiempo límite: 15 segundos fijos
• Dificultad aleatoria en quizzes automáticos
• Sistema de reacciones con emojis
• Fuente híbrida: API externa + banco local

${isAdmin ? '👑 *Como admin, tienes control total sobre los quizzes.*' : '💪 *Participa en las votaciones para iniciar quizzes divertidos!*'}`;
  
  await client.sendMessage(from, helpMessage);
}

// ─── DISTRIBUCIÓN DE CRÉDITOS ───────────────────────────────────────────────────
async function distributePrizes(client, groupId, results) {
  if (results.winners === 0) return;
  
  const { winners, prizePerWinner } = results;
  const successMessages = [];
  
  for (const userId of winners) {
    try {
      const user = db.getOrCreateUser(userId, groupId);
      const newBalance = db.updateUserCredits(userId, groupId, prizePerWinner, 'quiz_win', 
        `Ganaste quiz - ${prizePerWinner} créditos`);
      
      successMessages.push(`🏆 ${user.username || 'Usuario'}: +${prizePerWinner} créditos`);
    } catch (error) {
      console.error(`Error al dar premio a ${userId}:`, error.message);
    }
  }
  
  // Enviar mensaje de resultados
  let resultMessage = `🎯 *RESULTADOS DEL QUIZ* 🎯\n\n`;
  resultMessage += `✅ *Respuesta correcta:* ${results.correctAnswer}) ${results.correctOption}\n`;
  resultMessage += `👥 *Participantes:* ${results.totalResponses}\n`;
  resultMessage += `🏆 *Ganadores:* ${results.winners}\n`;
  resultMessage += `📚 *Fuente:* ${results.quizSource === 'api' ? 'API Externa' : 'Banco Local'}\n`;
  
  if (results.winners > 0) {
    resultMessage += `💰 *Premio por ganador:* ${results.prizePerWinner.toLocaleString()} créditos\n\n`;
    resultMessage += `*🎉 Ganadores:*\n${successMessages.join('\n')}`;
  } else {
    resultMessage += `\n😔 *Nadie respondió correctamente. El premio se acumula para el próximo quiz.*`;
  }
  
  await client.sendMessage(groupId, resultMessage);
}

// ─── FINALIZACIÓN DE QUIZ ───────────────────────────────────────────────────────
async function finishQuiz(groupId, client) {
  const result = endQuiz(groupId);
  if (!result) return;
  
  const { quizData, results } = result;
  
  // Guardar en la base de datos
  try {
    db.saveQuizHistory(
      groupId,
      quizData.id,
      quizData.quiz.difficulty,
      quizData.quiz.question,
      quizData.quiz.options[quizData.quiz.correct],
      results.totalResponses,
      results.winners,
      results.totalPrize
    );
  } catch (error) {
    console.error("Error guardando quiz history:", error.message);
  }
  
  let message = `⏰ *TIEMPO TERMINADO* ⏰\n\n`;
  
  if (results.winners > 0) {
    message += `🎉 *¡Hubo ${results.winners} ganador(es)!*\n\n`;
    await client.sendMessage(groupId, message);
    await distributePrizes(client, groupId, results);
  } else {
    message += `😔 *Nadie respondió correctamente*\n\n`;
    message += `✅ *Respuesta correcta:* ${results.correctAnswer}) ${results.correctOption}\n`;
    message += `👥 *Participantes:* ${results.totalResponses}\n`;
    message += `📚 *Fuente:* ${results.quizSource === 'api' ? 'API Externa' : 'Banco Local'}\n`;
    message += `💰 *Premio de ${results.totalPrize.toLocaleString()} créditos se acumula para el próximo quiz.*`;
    
    await client.sendMessage(groupId, message);
  }
}

// ─── PROCESAR RESPUESTAS DE QUIZ ─────────────────────────────────────────────────
async function processQuizAnswer(message, client) {
  const from = message.fromMe ? message.to : message.from;
  const senderId = message.author || message.from;
  const body = message.body.trim().toUpperCase();
  
  // Verificar si es una respuesta válida (A, B, C, D)
  if (!/^[ABCD]$/.test(body)) return false;
  
  const quizData = getActiveQuiz(from);
  if (!quizData || quizData.status !== 'active') return false;
  
  // Verificar si el tiempo ha expirado
  if (Date.now() - quizData.startTime > quizData.timeLimit) {
    return false;
  }
  
  // Enviar respuesta
  const success = submitAnswer(from, senderId, body);
  if (success) {
    // Confirmar recepción (opcional)
    await message.react("✅");
  }
  
  return success;
}

// ─── MANEJO DE REACCIONES DE QUIZ ───────────────────────────────────────────────
async function handleQuizPollReaction(reaction, client) {
  if (!reaction.message) return;
  
  const from = reaction.message.from;
  const senderId = reaction.senderId;
  const emoji = reaction.reaction;
  
  // Verificar si es un quiz activo
  const quizData = getActiveQuiz(from);
  if (quizData && quizData.status === 'active') {
    // Verificar si la reacción es para el mensaje del quiz
    if (quizData.quizMessageId && reaction.message.id._serialized !== quizData.quizMessageId) {
      return;
    }
    
    // Verificar si el tiempo ha expirado (15 segundos)
    if (Date.now() - quizData.startTime > QUIZ_TIME_LIMIT) {
      return;
    }
    
    // Verificar si el emoji es una resp válida (1️⃣ 2️⃣ 3️⃣ 4️⃣)
    const optionIndex = EMOJI_TO_INDEX[emoji];
    if (optionIndex === undefined) return;
    
    // Convertir índice a letra (0 -> A, 1 -> B, etc.)
    const answerLetter = INDEX_TO_LETTER[optionIndex];
    
    // Registrar la respuesta
    const success = submitAnswer(from, senderId, answerLetter);
    if (success) {
      console.log(`🧠 Respuesta de quiz: ${senderId} -> ${answerLetter}`);
    }
    return;
  }
  
  // Verificar si es una votación activa para iniciar quiz
  const pollData = activeQuizPolls.get(from);
  if (pollData) {
    // Verificar si la reacción es 1️⃣ (voto sí)
    if (emoji === '1️⃣' || emoji === '1') {
      // Verificar si el tiempo ha expirado
      if (Date.now() - pollData.startTime > pollData.timeout) {
        return;
      }
      
      // Guardar voto (solo una vez por usuario)
      if (!pollData.votes.has(senderId)) {
        pollData.votes.add(senderId);
        console.log(`🗳️ Voto de quiz registrado: ${senderId}`);
      }
    }
    return;
  }
}

module.exports = {
  handleQuizCommand,
  processQuizAnswer,
  handleQuizPollReaction,
  getActiveQuiz,
  createRandomQuiz,
  finishQuiz,
  formatQuizMessage,
  getQuizStats,
  QUIZ_PRIZES
};