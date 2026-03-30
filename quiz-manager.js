const https = require('https');
const { QUIZ_BANK, QUIZ_PRIZES, QUIZ_CATEGORIES } = require('./quiz-data');

// ─── CONFIGURACIÓN DE API ───────────────────────────────────────────────────────
const QUIZ_API_CONFIG = {
  enabled: process.env.QUIZ_API_ENABLED === "true",
  url: process.env.QUIZ_API_URL || "https://opentdb.com/api.php",
  timeout: parseInt(process.env.QUIZ_API_TIMEOUT) || 5000,
  fallbackToLocal: process.env.QUIZ_API_FALLBACK !== "false"
};

// ─── QUIZZES ACTIVOS EN MEMORIA ───────────────────────────────────────────────────
const activeQuizzes = new Map(); // groupId -> quizData

// ─── FUNCIONES DE API EXTERNA ─────────────────────────────────────────────────────
async function fetchQuizFromAPI(difficulty = 'medium', amount = 1, category = null) {
  if (!QUIZ_API_CONFIG.enabled) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      amount: amount,
      type: 'multiple',
      difficulty: difficulty,
      encode: 'url3986'
    });

    if (category) {
      params.append('category', category);
    }

    const url = `${QUIZ_API_CONFIG.url}?${params}`;
    
    const req = https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.response_code === 0 && result.results.length > 0) {
            resolve(transformAPIData(result.results[0]));
          } else {
            resolve(null);
          }
        } catch (error) {
          console.error('Error parsing API response:', error);
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error fetching quiz from API:', error);
      resolve(null);
    });

    req.setTimeout(QUIZ_API_CONFIG.timeout, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function transformAPIData(apiData) {
  // Transformar datos de Open Trivia DB a nuestro formato
  const options = [...apiData.incorrect_answers, apiData.correct_answer];
  const correctIndex = options.indexOf(apiData.correct_answer);
  
  // Mezclar opciones
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  
  // Encontrar nuevo índice de la respuesta correcta
  const newCorrectIndex = options.indexOf(apiData.correct_answer);
  
  // Determinar dificultad basada en la API
  const difficultyMap = {
    'easy': 'easy',
    'medium': 'normal',
    'hard': 'hard'
  };
  
  return {
    question: decodeURIComponent(apiData.question),
    options: options.map(opt => decodeURIComponent(opt)),
    correct: newCorrectIndex,
    category: apiData.category.toLowerCase(),
    difficulty: difficultyMap[apiData.difficulty] || 'normal',
    source: 'api'
  };
}

// ─── FUNCIONES DE GESTIÓN DE QUIZZES ───────────────────────────────────────────────
function getRandomQuiz(difficulty = 'normal', useAPI = true) {
  // Intentar obtener de API primero si está habilitado
  if (useAPI && QUIZ_API_CONFIG.enabled) {
    return fetchQuizFromAPI(difficulty).then(apiQuiz => {
      if (apiQuiz) {
        console.log(`🧠 Quiz obtenido de API: ${apiQuiz.category}`);
        return apiQuiz;
      }
      
      // Fallback a datos locales
      if (QUIZ_API_CONFIG.fallbackToLocal) {
        return getRandomQuizLocal(difficulty);
      }
      
      return null;
    }).catch(error => {
      console.error('Error en API, usando fallback local:', error);
      return QUIZ_API_CONFIG.fallbackToLocal ? getRandomQuizLocal(difficulty) : null;
    });
  }
  
  // Usar solo datos locales
  return getRandomQuizLocal(difficulty);
}

function getRandomQuizLocal(difficulty = 'normal') {
  const quizzes = QUIZ_BANK[difficulty];
  if (!quizzes || quizzes.length === 0) return null;
  
  const randomIndex = Math.floor(Math.random() * quizzes.length);
  return { 
    ...quizzes[randomIndex], 
    difficulty,
    source: 'local'
  };
}

function createQuiz(groupId, difficulty = 'normal', timeLimit = null) {
  return getRandomQuiz(difficulty).then(quiz => {
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
      pollMessageId: null,
      status: 'active'
    };
    
    activeQuizzes.set(groupId, quizData);
    return quizData;
  });
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
    })),
    quizSource: quiz.source || 'local'
  };
}

// ─── FUNCIONES DE FORMATEO ───────────────────────────────────────────────────────
function formatQuizMessage(quiz, timeLimit = null) {
  const emoji = quiz.difficulty === 'easy' ? '🟢' : quiz.difficulty === 'normal' ? '🟡' : '🔴';
  const categoryEmoji = QUIZ_CATEGORIES[quiz.category] || '📝';
  const prize = QUIZ_PRIZES[quiz.difficulty];
  
  // Usar tiempo límite global si no se especifica
  const actualTimeLimit = timeLimit || (process.env.QUIZ_TIME_LIMIT ? parseInt(process.env.QUIZ_TIME_LIMIT) : 10);
  
  let message = `${emoji} *QUIZ ${quiz.difficulty.toUpperCase()}* 🎯\n\n`;
  message += `${categoryEmoji} *Categoría:* ${quiz.category}\n`;
  message += `💰 *Premio total:* ${prize.toLocaleString()} créditos\n`;
  message += `⏱️ *Tiempo límite:* ${actualTimeLimit} segundos\n`;
  message += `${quiz.source === 'api' ? '🌐 *Fuente:* API Externa' : '📚 *Fuente:* Local'}\n\n`;
  message += `📝 *Pregunta:* ${quiz.question}\n\n`;
  
  return message;
}

function createPollOptions(quiz) {
  return quiz.options.map((option, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, D
    return `${letter}) ${option}`;
  });
}

// ─── FUNCIONES DE ESTADÍSTICAS ─────────────────────────────────────────────────────
function getQuizStats() {
  const stats = {
    local: {
      easy: QUIZ_BANK.easy.length,
      normal: QUIZ_BANK.normal.length,
      hard: QUIZ_BANK.hard.length,
      total: QUIZ_BANK.easy.length + QUIZ_BANK.normal.length + QUIZ_BANK.hard.length
    },
    api: {
      enabled: QUIZ_API_CONFIG.enabled,
      url: QUIZ_API_CONFIG.url,
      timeout: QUIZ_API_CONFIG.timeout,
      fallback: QUIZ_API_CONFIG.fallbackToLocal
    },
    active: activeQuizzes.size
  };
  
  return stats;
}

// ─── LIMPIEZA DE QUIZZES EXPIRADOS ───────────────────────────────────────────────
function cleanupExpiredQuizzes() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [groupId, quizData] of activeQuizzes) {
    if (now - quizData.startTime > quizData.timeLimit + 60000) { // + 1min de gracia
      activeQuizzes.delete(groupId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Limpieza de quizzes expirados: ${cleaned} eliminados`);
  }
}

// Auto-limpieza cada 5 minutos
setInterval(cleanupExpiredQuizzes, 300000);

module.exports = {
  // Gestión de quizzes
  getRandomQuiz,
  createQuiz,
  createRandomQuiz,
  getActiveQuiz,
  endQuiz,
  submitAnswer,
  calculateResults,
  
  // Formateo
  formatQuizMessage,
  createPollOptions,
  
  // API
  fetchQuizFromAPI,
  
  // Utilidades
  getQuizStats,
  cleanupExpiredQuizzes,
  
  // Configuración
  QUIZ_PRIZES,
  QUIZ_CATEGORIES,
  QUIZ_API_CONFIG
};
