const db = require("./database");

// ─── BANCO DE PREGUNTAS ────────────────────────────────────────────────────────────
const QUIZ_BANK = {
  easy: [
    {
      question: "¿Cuánto es 2 + 2?",
      options: ["3", "4", "5", "6"],
      correct: 1,
      category: "matemática"
    },
    {
      question: "¿Cuál es el planeta más grande del sistema solar?",
      options: ["Tierra", "Marte", "Júpiter", "Saturno"],
      correct: 2,
      category: "ciencia"
    },
    {
      question: "¿En qué año comenzó la Segunda Guerra Mundial?",
      options: ["1914", "1939", "1945", "1968"],
      correct: 1,
      category: "historia"
    },
    {
      question: "¿Cuál es la capital de Francia?",
      options: ["Londres", "Berlín", "Madrid", "París"],
      correct: 3,
      category: "geografía"
    },
    {
      question: "¿Cuántos continentes hay?",
      options: ["5", "6", "7", "8"],
      correct: 2,
      category: "geografía"
    }
  ],
  normal: [
    {
      question: "¿Quién pintó la Mona Lisa?",
      options: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"],
      correct: 1,
      category: "arte"
    },
    {
      question: "¿Cuál es el elemento químico más abundante en el universo?",
      options: ["Oxígeno", "Carbono", "Helio", "Hidrógeno"],
      correct: 3,
      category: "ciencia"
    },
    {
      question: "¿En qué año cayó el Imperio Romano de Occidente?",
      options: ["476 d.C.", "1066 d.C.", "1453 d.C.", "1789 d.C."],
      correct: 0,
      category: "historia"
    },
    {
      question: "¿Cuál es el río más largo del mundo?",
      options: ["Amazonas", "Nilo", "Yangtsé", "Misisipi"],
      correct: 1,
      category: "geografía"
    },
    {
      question: "¿Quién escribió 'Don Quijote de la Mancha'?",
      options: ["Lope de Vega", "Cervantes", "Calderón", "Garcilaso"],
      correct: 1,
      category: "literatura"
    }
  ],
  hard: [
    {
      question: "¿Cuál es la velocidad de la luz en el vacío?",
      options: ["299,792 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"],
      correct: 0,
      category: "física"
    },
    {
      question: "¿Cuántos huesos tiene el cuerpo humano adulto?",
      options: ["186", "206", "226", "246"],
      correct: 1,
      category: "biología"
    },
    {
      question: "¿En qué año se firmó la Declaración de Independencia de EE.UU.?",
      options: ["1775", "1776", "1777", "1778"],
      correct: 1,
      category: "historia"
    },
    {
      question: "¿Cuál es el país más pequeño del mundo?",
      options: ["Mónaco", "Vaticano", "San Marino", "Liechtenstein"],
      correct: 1,
      category: "geografía"
    },
    {
      question: "¿Quién descubrió la penicilina?",
      options: ["Pasteur", "Fleming", "Koch", "Salk"],
      correct: 1,
      category: "ciencia"
    }
  ]
};

// ─── CONFIGURACIÓN DE PREMIOS ─────────────────────────────────────────────────────
const QUIZ_PRIZES = {
  easy: 50000,
  normal: 100000,
  hard: 200000
};

// ─── FUNCIONES AUXILIARES ────────────────────────────────────────────────────────
function getRandomQuiz(difficulty) {
  const quizzes = QUIZ_BANK[difficulty];
  if (!quizzes || quizzes.length === 0) return null;
  
  const randomIndex = Math.floor(Math.random() * quizzes.length);
  return { ...quizzes[randomIndex], difficulty };
}

function formatQuizMessage(quiz, timeLimit = null) {
  const emoji = quiz.difficulty === 'easy' ? '🟢' : quiz.difficulty === 'normal' ? '🟡' : '🔴';
  const prize = QUIZ_PRIZES[quiz.difficulty];
  
  // Usar tiempo límite global si no se especifica
  const actualTimeLimit = timeLimit || (process.env.QUIZ_TIME_LIMIT ? parseInt(process.env.QUIZ_TIME_LIMIT) : 10);
  
  let message = `${emoji} *QUIZ ${quiz.difficulty.toUpperCase()}* 🎯\n\n`;
  message += `💰 *Premio total:* ${prize.toLocaleString()} créditos\n`;
  message += `⏱️ *Tiempo límite:* ${actualTimeLimit} segundos\n\n`;
  message += `📝 *Pregunta:* ${quiz.question}\n\n`;
  
  return message;
}

function createPollOptions(quiz) {
  return quiz.options.map((option, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, D
    return `${letter}) ${option}`;
  });
}

// ─── MANEJO DE QUIZZES ACTIVOS ───────────────────────────────────────────────────
const activeQuizzes = new Map(); // groupId -> quizData

function createQuiz(groupId, difficulty = 'normal', timeLimit = null) {
  const quiz = getRandomQuiz(difficulty);
  if (!quiz) return null;
  
  // Usar tiempo límite global si no se especifica
  const actualTimeLimit = timeLimit || (process.env.QUIZ_TIME_LIMIT ? parseInt(process.env.QUIZ_TIME_LIMIT) * 1000 : 10000);
  
  const quizData = {
    id: Date.now().toString(),
    groupId,
    quiz,
    startTime: Date.now(),
    timeLimit: actualTimeLimit, // en milisegundos
    responses: new Map(), // userId -> answer
    pollMessageId: null, // Para guardar el ID del mensaje del poll
    status: 'active'
  };
  
  activeQuizzes.set(groupId, quizData);
  return quizData;
}

function createRandomQuiz(groupId, difficulty) {
  return createQuiz(groupId, difficulty);
}

function getActiveQuiz(groupId) {
  return activeQuizzes.get(groupId);
}

function endQuiz(groupId) {
  const quizData = activeQuizzes.get(groupId);
  if (!quizData) return null;
  
  quizData.status = 'ended';
  const results = calculateResults(quizData);
  
  // Limpiar quiz activo después de un tiempo
  setTimeout(() => {
    activeQuizzes.delete(groupId);
  }, 5000);
  
  return { quizData, results };
}

function submitAnswer(groupId, userId, answer) {
  const quizData = activeQuizzes.get(groupId);
  if (!quizData || quizData.status !== 'active') return false;
  
  // Verificar si el tiempo ha expirado
  if (Date.now() - quizData.startTime > quizData.timeLimit) {
    quizData.status = 'expired';
    return false;
  }
  
  // Guardar respuesta (solo la primera respuesta cuenta)
  if (!quizData.responses.has(userId)) {
    quizData.responses.set(userId, answer.toUpperCase());
    return true;
  }
  
  return false; // Ya había respondido
}

function calculateResults(quizData) {
  const { quiz, responses } = quizData;
  const correctAnswer = String.fromCharCode(65 + quiz.correct); // Convertir índice a letra
  const winners = [];
  
  // Encontrar ganadores
  for (const [userId, answer] of responses) {
    if (answer === correctAnswer) {
      winners.push(userId);
    }
  }
  
  const prize = QUIZ_PRIZES[quiz.difficulty];
  const prizePerWinner = winners.length > 0 ? Math.floor(prize / winners.length) : 0;
  
  return {
    correctAnswer,
    correctOption: quiz.options[quiz.correct],
    totalResponses: responses.size,
    winners: winners.length,
    prizePerWinner,
    totalPrize: prize,
    allResponses: Array.from(responses.entries()).map(([userId, answer]) => ({
      userId,
      answer,
      isCorrect: answer === correctAnswer
    }))
  };
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
  
  if (results.winners > 0) {
    resultMessage += `💰 *Premio por ganador:* ${results.prizePerWinner.toLocaleString()} créditos\n\n`;
    resultMessage += `*🎉 Ganadores:*\n${successMessages.join('\n')}`;
  } else {
    resultMessage += `\n😔 *Nadie respondió correctamente. El premio se acumula para el próximo quiz.*`;
  }
  
  await client.sendMessage(groupId, resultMessage);
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
  
  // Crear quiz
  const quizData = createQuiz(from, difficulty);
  if (!quizData) {
    await client.sendMessage(from, "❌ *Error:* No se pudo crear el quiz. Intenta más tarde.");
    return;
  }
  
  // Enviar mensaje del quiz
  const quizMessage = formatQuizMessage(quizData.quiz);
  const pollOptions = createPollOptions(quizData.quiz);
  
  try {
    // Enviar como poll
    const pollMessage = await client.sendMessage(from, quizMessage, {
      poll: {
        name: quizData.quiz.question,
        options: pollOptions,
        allowMultipleAnswers: false
      }
    });
    
    // Guardar el ID del mensaje del poll
    quizData.pollMessageId = pollMessage.id._serialized;
    
    console.log(`🧠 Quiz poll creado: ${quizData.pollMessageId}`);
    
  } catch (error) {
    console.error("Error creando poll:", error.message);
    
    // Fallback: enviar mensaje normal
    const fallbackMessage = quizMessage + "\n\n" + pollOptions.join("\n");
    await client.sendMessage(from, fallbackMessage);
  }
  
  // Configurar timeout para terminar el quiz automáticamente
  setTimeout(async () => {
    const activeQuiz = getActiveQuiz(from);
    if (activeQuiz && activeQuiz.status === 'active') {
      await finishQuiz(from, client);
    }
  }, quizData.timeLimit);
}

async function handleQuizStop(message, client) {
  const from = message.fromMe ? message.to : message.from;
  const senderId = message.author || message.from;
  
  const quizData = getActiveQuiz(from);
  if (!quizData) {
    await client.sendMessage(from, "⚠️ *No hay ningún quiz activo en este grupo.*");
    return;
  }
  
  await finishQuiz(from, client);
}

async function handleQuizHelp(message, client) {
  const from = message.fromMe ? message.to : message.from;
  
  const helpMessage = `🎯 *COMANDOS DE QUIZ* 🎯

📝 *Comandos disponibles:*
▸ \`/quiz start\` — Inicia quiz normal (🟡 100,000 créditos)
▸ \`/quiz start easy\` — Quiz fácil (🟢 50,000 créditos)  
▸ \`/quiz start hard\` — Quiz difícil (🔴 200,000 créditos)
▸ \`/quiz stop\` — Detiene el quiz actual
▸ \`/quiz help\` — Muestra esta ayuda

🎮 *Cómo funciona:*
1. Al iniciar un quiz, tienes 30 segundos para responder
2. Responde con la letra de tu opción (A, B, C o D)
3. El premio se divide equitativamente entre todos los que acierten
4. Solo cuenta tu primera respuesta

💡 *Consejo:* ¡Lee rápido y responde con confianza!`;
  
  await client.sendMessage(from, helpMessage);
}

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

// ─── MANEJO DE POLLS DE QUIZ ─────────────────────────────────────────────────────
async function handleQuizPollReaction(reaction, client) {
  const from = reaction.message.from;
  const senderId = reaction.senderId;
  
  // Buscar quiz activo en este grupo
  const quizData = getActiveQuiz(from);
  if (!quizData || quizData.status !== 'active') return;
  
  // Verificar si la reacción es para el mensaje del poll
  if (quizData.pollMessageId && reaction.message.id._serialized !== quizData.pollMessageId) {
    return;
  }
  
  // Verificar si el tiempo ha expirado
  if (Date.now() - quizData.startTime > quizData.timeLimit) {
    return;
  }
  
  // Obtener la opción seleccionada del poll
  try {
    const poll = await reaction.message.getPoll();
    if (!poll) return;
    
    // Buscar la votación de este usuario
    const userVote = poll.votes.find(vote => vote.voterId === senderId);
    if (!userVote) return;
    
    // Convertir el índice de la opción a letra (0 -> A, 1 -> B, etc.)
    const selectedOptionIndex = userVote.selectedOptions[0];
    const answerLetter = String.fromCharCode(65 + selectedOptionIndex);
    
    // Registrar la respuesta
    const success = submitAnswer(from, senderId, answerLetter);
    if (success) {
      console.log(`🧠 Respuesta de quiz registrada: ${senderId} -> ${answerLetter}`);
    }
    
  } catch (error) {
    console.error("Error procesando poll de quiz:", error.message);
  }
}

module.exports = {
  handleQuizCommand,
  processQuizAnswer,
  handleQuizPollReaction,
  getActiveQuiz,
  createQuiz,
  createRandomQuiz,
  endQuiz,
  formatQuizMessage,
  finishQuiz,
  createPollOptions,
  QUIZ_PRIZES,
  QUIZ_BANK
};
