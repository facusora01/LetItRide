// ─── BANCO DE PREGUNTAS LOCAL ─────────────────────────────────────────────────────
// Este archivo contiene solo los datos de los quizzes, sin lógica de negocio

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
    },
    {
      question: "¿Cuál es el animal más grande del mundo?",
      options: ["Elefante", "Ballena azul", "Jirafa", "Tiburón"],
      correct: 1,
      category: "ciencia"
    },
    {
      question: "¿Cuántos días tiene un año bisiesto?",
      options: ["364", "365", "366", "367"],
      correct: 2,
      category: "matemática"
    },
    {
      question: "¿De qué color es el cielo en un día despejado?",
      options: ["Verde", "Rojo", "Azul", "Amarillo"],
      correct: 2,
      category: "ciencia"
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
    },
    {
      question: "¿Cuál es la montaña más alta del mundo?",
      options: ["K2", "Monte Everest", "Aconcagua", "Makalu"],
      correct: 1,
      category: "geografía"
    },
    {
      question: "¿Quién descubrió América?",
      options: ["Américo Vespucio", "Cristóbal Colón", "Hernán Cortés", "Fernando de Magallanes"],
      correct: 1,
      category: "historia"
    },
    {
      question: "¿Cuántos huesos tiene el cuerpo humano adulto?",
      options: ["186", "206", "226", "246"],
      correct: 1,
      category: "biología"
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
    },
    {
      question: "¿Cuál es el elemento más pesado que ocurre naturalmente?",
      options: ["Uranio", "Plutonio", "Plomo", "Oro"],
      correct: 0,
      category: "química"
    },
    {
      question: "¿En qué año comenzó la Primera Guerra Mundial?",
      options: ["1912", "1913", "1914", "1915"],
      correct: 2,
      category: "historia"
    },
    {
      question: "¿Cuál es la constante de Planck aproximadamente?",
      options: ["6.626 × 10⁻³⁴ J·s", "3.141 × 10⁻³⁴ J·s", "9.806 × 10⁻³⁴ J·s", "2.718 × 10⁻³⁴ J·s"],
      correct: 0,
      category: "física"
    }
  ]
};

// ─── CONFIGURACIÓN DE PREMIOS ─────────────────────────────────────────────────────
const QUIZ_PRIZES = {
  easy: 50000,
  normal: 100000,
  hard: 200000
};

// ─── CATEGORIAS DISPONIBLES ─────────────────────────────────────────────────────
const QUIZ_CATEGORIES = {
  matemática: "🔢",
  ciencia: "🔬",
  historia: "📚",
  geografía: "🌍",
  arte: "🎨",
  literatura: "📖",
  biología: "🧬",
  física: "⚛️",
  química: "🧪"
};

module.exports = {
  QUIZ_BANK,
  QUIZ_PRIZES,
  QUIZ_CATEGORIES
};
