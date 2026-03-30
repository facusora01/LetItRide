const db = require("./database");
const { Poll } = require("whatsapp-web.js");
const { QUIZ_BANK, QUIZ_PRIZES, QUIZ_CATEGORIES } = require("./quiz-data");
const { isAdmin } = require("./commands");

// ─── QUIZZES ACTIVOS ──────────────────────────────────────────────────────────────
// groupId → { id, quiz, startTime, timeLimit, responses, pollMessageId, status }
const activeQuizzes = new Map();

// ─── HELPERS ──────────────────────────────────────────────────────────────────────
function getRandomQuiz(difficulty = 'normal') {
  const bank = QUIZ_BANK[difficulty];
  if (!bank || bank.length === 0) return null;
  return { ...bank[Math.floor(Math.random() * bank.length)], difficulty };
}

function getTimeLimit() {
  return parseInt(process.env.QUIZ_TIME_LIMIT) || 30; // segundos
}

function formatInfoMessage(quiz) {
  const emoji = quiz.difficulty === 'easy' ? '🟢' : quiz.difficulty === 'normal' ? '🟡' : '🔴';
  const catEmoji = QUIZ_CATEGORIES[quiz.category] || '📝';
  const prize = QUIZ_PRIZES[quiz.difficulty];
  const secs = getTimeLimit();

  return (
    `${emoji} *QUIZ ${quiz.difficulty.toUpperCase()}* 🎯\n\n` +
    `${catEmoji} *Categoría:* ${quiz.category}\n` +
    `💰 *Premio total:* ${prize.toLocaleString()} créditos\n` +
    `⏱️ *Tiempo límite:* ${secs} segundos\n\n` +
    `📝 Respondé haciendo clic en una opción del poll de abajo 👇`
  );
}

// ─── GESTIÓN DE QUIZ ──────────────────────────────────────────────────────────────
function createQuiz(groupId, difficulty = 'normal') {
  const quiz = getRandomQuiz(difficulty);
  if (!quiz) return null;

  const quizData = {
    id: Date.now().toString(),
    groupId,
    quiz,
    startTime: Date.now(),
    timeLimit: getTimeLimit() * 1000,
    responses: new Map(),
    pollMessageId: null,
    status: 'active'
  };
  activeQuizzes.set(groupId, quizData);
  return quizData;
}

function getActiveQuiz(groupId) {
  return activeQuizzes.get(groupId);
}

function submitAnswer(groupId, userId, answerLetter) {
  const q = activeQuizzes.get(groupId);
  if (!q || q.status !== 'active') return false;
  if (Date.now() - q.startTime > q.timeLimit) { q.status = 'expired'; return false; }
  if (q.responses.has(userId)) return false; // ya respondió
  q.responses.set(userId, answerLetter.toUpperCase());
  return true;
}

function endQuiz(groupId) {
  const q = activeQuizzes.get(groupId);
  if (!q) return null;
  q.status = 'ended';
  const results = calculateResults(q);
  setTimeout(() => activeQuizzes.delete(groupId), 5000);
  return { quizData: q, results };
}

function calculateResults(quizData) {
  const { quiz, responses } = quizData;
  const correctLetter = String.fromCharCode(65 + quiz.correct);
  const winners = [];
  for (const [userId, answer] of responses) {
    if (answer === correctLetter) winners.push(userId);
  }
  const prize = QUIZ_PRIZES[quiz.difficulty];
  const prizePerWinner = winners.length > 0 ? Math.floor(prize / winners.length) : 0;
  return {
    correctLetter,
    correctOption: quiz.options[quiz.correct],
    totalResponses: responses.size,
    winners,
    prizePerWinner,
    totalPrize: prize,
  };
}

// ─── ENVÍO DEL QUIZ (FIX CORREGIDO) ────┬───┬───┬───────┬─┬───────┬───────
async function sendQuiz(client, groupId, quizData) {
  const { quiz } = quizData;

  // 1. Mensaje informativo
  await client.sendMessage(groupId, formatInfoMessage(quiz));

  // 2. Poll nativo usando el objeto de opciones
  const pollOptions = quiz.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`);
  
  const pollMsg = await client.sendMessage(groupId, {
    poll: {
      name: quiz.question,
      options: pollOptions,
      allowMultipleAnswers: false
    }
  });

  // Guardar el ID del poll para detectar votos
  quizData.pollMessageId = pollMsg.id._serialized;
  console.log(`🧠 Poll de quiz enviado: ${quizData.pollMessageId}`);
}

// ─── FINALIZACIÓN ─────────────────────────────────────────────────────────────────
async function finishQuiz(groupId, client) {
  const result = endQuiz(groupId);
  if (!result) return;
  const { quizData, results } = result;

  // Intentar guardar en DB (si existe el método)
  try {
    db.saveQuizHistory?.(
      groupId, quizData.id, quizData.quiz.difficulty,
      quizData.quiz.question, results.correctOption,
      results.totalResponses, results.winners.length, results.totalPrize
    );
  } catch (e) {}

  let msg = `⏰ *TIEMPO TERMINADO* ⏰\n\n`;

  if (results.winners.length > 0) {
    msg += `🎉 *¡${results.winners.length} ganador(es)!*\n\n`;
    msg += `✅ *Respuesta correcta:* ${results.correctLetter}) ${results.correctOption}\n`;
    msg += `👥 *Participantes:* ${results.totalResponses}\n\n`;
    msg += `*🏆 Ganadores:*\n`;

    for (const userId of results.winners) {
      try {
        const newBalance = db.updateUserCredits(userId, groupId, results.prizePerWinner,
          'quiz_win', `Ganaste quiz`);
        const user = db.getOrCreateUser(userId, groupId);
        msg += `👤 ${user.username || userId.split('@')[0]}: +${results.prizePerWinner.toLocaleString()} créditos\n`;
      } catch (e) {
        console.error(`Error dando premio a ${userId}:`, e.message);
      }
    }
  } else {
    msg += `😔 *Nadie respondió correctamente*\n\n`;
    msg += `✅ *Respuesta correcta:* ${results.correctLetter}) ${results.correctOption}\n`;
    msg += `👥 *Participantes:* ${results.totalResponses}\n`;
    msg += `💰 *Premio de ${results.totalPrize.toLocaleString()} créditos se acumula para el próximo quiz.*`;
  }

  await client.sendMessage(groupId, msg);
}

// ─── COMANDOS ─────────────────────────────────────────────────────────────────────
async function handleQuizCommand(message, client) {
  const body = message.body.trim().toLowerCase();
  const from = message.fromMe ? message.to : message.from;
  const parts = body.split(' ');
  const sub = parts[1];

  if (sub === 'start') return handleQuizStart(message, client, parts);
  if (sub === 'stop')  return handleQuizStop(message, client);
  return handleQuizHelp(message, client);
}

async function handleQuizStart(message, client, parts) {
  const from = message.fromMe ? message.to : message.from;

  // Solo admins pueden iniciar quizzes
  const isUserAdmin = await isAdmin(message, client);
  if (!isUserAdmin) {
    return client.sendMessage(from,
      "🔒 *Solo los admins pueden iniciar quizzes.*\n" +
      "Pedí a un admin que lo inicie por vos.");
  }

  if (getActiveQuiz(from)) {
    return client.sendMessage(from,
      "⚠️ *Ya hay un quiz activo.*\nUsá `/quiz stop` para cancelarlo.");
  }

  let difficulty = 'normal';
  if (parts[2]) {
    if (['easy', 'facil', 'fácil'].includes(parts[2])) difficulty = 'easy';
    else if (['hard', 'dificil', 'difícil'].includes(parts[2])) difficulty = 'hard';
  }

  const quizData = createQuiz(from, difficulty);
  if (!quizData) return client.sendMessage(from, "❌ No se pudo crear el quiz.");

  await sendQuiz(client, from, quizData);

  // Auto-cierre
  setTimeout(async () => {
    const q = getActiveQuiz(from);
    if (q && q.status === 'active') await finishQuiz(from, client);
  }, quizData.timeLimit);
}

async function handleQuizStop(message, client) {
  const from = message.fromMe ? message.to : message.from;
  if (!getActiveQuiz(from))
    return client.sendMessage(from, "⚠️ *No hay ningún quiz activo.*");
  await finishQuiz(from, client);
}

async function handleQuizHelp(message, client) {
  const from = message.fromMe ? message.to : message.from;
  const secs = getTimeLimit();
  await client.sendMessage(from,
    `🎯 *COMANDOS DE QUIZ* 🎯\n\n` +
    `▸ \`/quiz start\` — Quiz normal (🟡 100.000 créditos)\n` +
    `▸ \`/quiz start easy\` — Quiz fácil (🟢 50.000 créditos)\n` +
    `▸ \`/quiz start hard\` — Quiz difícil (🔴 200.000 créditos)\n` +
    `▸ \`/quiz stop\` — Cancela el quiz actual\n\n` +
    `🎮 *Cómo funciona:*\n` +
    `• Tenés ${secs} segundos para votar en el poll\n` +
    `• Solo cuenta tu primera respuesta\n` +
    `• El premio se divide entre todos los que acierten`
  );
}

// ─── VOTOS DE POLL (escuchado desde index.js via message_create type poll_vote) ───
// whatsapp-web.js expone los votos como mensajes con type === 'poll_vote'
// groupId es el from del voto, selectedOptions es un array de índices
async function handleQuizPollVote(voteMessage, client) {
  try {
    const groupId = voteMessage.fromMe ? voteMessage.to : voteMessage.from;
    const senderId = voteMessage.author || voteMessage.from;

    const q = getActiveQuiz(groupId);
    if (!q || q.status !== 'active') return;

    // Verificar que el voto corresponde al poll de este quiz
    const parentId = voteMessage._data?.pollMessageId?._serialized
      || voteMessage._data?.parentMessage?.id?._serialized;
    if (q.pollMessageId && parentId && parentId !== q.pollMessageId) return;

    // selectedOptions es array de índices (0=A, 1=B, 2=C, 3=D)
    const selected = voteMessage._data?.selectedOptions?.[0];
    if (selected === undefined) return;

    const answerLetter = String.fromCharCode(65 + selected);
    const submitted = submitAnswer(groupId, senderId, answerLetter);
    if (submitted) {
      console.log(`🧠 Quiz voto: ${senderId} → ${answerLetter}`);
    }
  } catch (err) {
    console.error("❌ Error en handleQuizPollVote:", err.message);
  }
}

module.exports = {
  handleQuizCommand,
  handleQuizPollVote,
  getActiveQuiz,
  createQuiz,
  finishQuiz,
  sendQuiz,
  QUIZ_PRIZES,
  QUIZ_BANK,
};