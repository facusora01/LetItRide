// ─── BANCO DE PREGUNTAS LOCAL ─────────────────────────────────────────────────────
// Este archivo contiene solo los datos de los quizzes, sin lógica de negocio

const QUIZ_BANK = {
  easy: [
    { question: "¿Cuánto es 2 + 2?", options: ["3", "4", "5", "6"], correct: 1, category: "matematicas" },
    { question: "¿Cuál es el planeta más grande del sistema solar?", options: ["Tierra", "Júpiter", "Marte", "Saturno"], correct: 1, category: "ciencias" },
    { question: "¿En qué continente se encuentra Egipto?", options: ["Asia", "Europa", "África", "América"], correct: 2, category: "geografia" },
    { question: "¿Cuántos lados tiene un hexágono?", options: ["5", "6", "7", "8"], correct: 1, category: "matematicas" },
    { question: "¿Cuál es el animal terrestre más rápido?", options: ["León", "Guepardo", "Caballo", "Gacela"], correct: 1, category: "animales" },
    { question: "¿En qué año comenzó la Segunda Guerra Mundial?", options: ["1914", "1939", "1945", "1968"], correct: 1, category: "historia" },
    { question: "¿Cuál es la capital de Francia?", options: ["Londres", "Berlín", "Madrid", "París"], correct: 3, category: "geografia" },
    { question: "¿Cuántos continentes hay?", options: ["5", "6", "7", "8"], correct: 2, category: "geografia" },
    { question: "¿Cuál es el animal más grande del mundo?", options: ["Elefante", "Ballena azul", "Jirafa", "Tiburón"], correct: 1, category: "ciencias" },
    { question: "¿Cuántos días tiene un año bisiesto?", options: ["364", "365", "366", "367"], correct: 2, category: "matematicas" },
    { question: "¿De qué color es el cielo en un día despejado?", options: ["Verde", "Rojo", "Azul", "Amarillo"], correct: 2, category: "ciencias" },
    { question: "¿Cuántos dedos tiene una mano humana?", options: ["4", "5", "6", "10"], correct: 1, category: "ciencias" },
  ],
  normal: [
    { question: "¿Quién pintó la Mona Lisa?", options: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"], correct: 1, category: "arte" },
    { question: "¿En qué año llegó el hombre a la luna?", options: ["1969", "1975", "1965", "1980"], correct: 0, category: "historia" },
    { question: "¿Cuál es el elemento químico con símbolo O?", options: ["Oro", "Osmio", "Oxígeno", "Olivo"], correct: 2, category: "ciencias" },
    { question: "¿Cuál es el elemento más abundante en el universo?", options: ["Oxígeno", "Carbono", "Helio", "Hidrógeno"], correct: 3, category: "ciencias" },
    { question: "¿En qué año cayó el Imperio Romano de Occidente?", options: ["476 d.C.", "1066 d.C.", "1453 d.C.", "1789 d.C."], correct: 0, category: "historia" },
    { question: "¿Cuál es el río más largo del mundo?", options: ["Amazonas", "Nilo", "Yangtsé", "Misisipi"], correct: 1, category: "geografia" },
    { question: "¿Quién escribió 'Don Quijote de la Mancha'?", options: ["Lope de Vega", "Cervantes", "Calderón", "Garcilaso"], correct: 1, category: "literatura" },
    { question: "¿Cuál es la montaña más alta del mundo?", options: ["K2", "Monte Everest", "Aconcagua", "Makalu"], correct: 1, category: "geografia" },
    { question: "¿Quién descubrió América?", options: ["Américo Vespucio", "Cristóbal Colón", "Hernán Cortés", "Magallanes"], correct: 1, category: "historia" },
    { question: "¿Cuál es la capital de Australia?", options: ["Sídney", "Melbourne", "Canberra", "Perth"], correct: 2, category: "geografia" },
    { question: "¿Cuántos huesos tiene el cuerpo humano adulto?", options: ["186", "206", "226", "246"], correct: 1, category: "ciencias" },
  ],
  hard: [
    { question: "¿Cuál es la velocidad de la luz en el vacío?", options: ["299,792 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"], correct: 0, category: "fisica" },
    { question: "¿En qué año cayó el Muro de Berlín?", options: ["1987", "1989", "1991", "1985"], correct: 1, category: "historia" },
    { question: "¿Cuál es el libro más vendido de Dan Brown?", options: ["Angels & Demons", "The Da Vinci Code", "Inferno", "Origin"], correct: 1, category: "literatura" },
    { question: "¿Quién compuso la Sinfonía Fantástica?", options: ["Hans Zimmer", "Beethoven", "Berlioz", "Mozart"], correct: 2, category: "musica" },
    { question: "¿Cuál es la capital de Islandia?", options: ["Oslo", "Reykjavik", "Copenhague", "Estocolmo"], correct: 1, category: "geografia" },
    { question: "¿En qué año se firmó la Declaración de Independencia de EE.UU.?", options: ["1775", "1776", "1777", "1778"], correct: 1, category: "historia" },
    { question: "¿Cuál es el país más pequeño del mundo?", options: ["Mónaco", "Vaticano", "San Marino", "Liechtenstein"], correct: 1, category: "geografia" },
    { question: "¿Quién descubrió la penicilina?", options: ["Pasteur", "Fleming", "Koch", "Salk"], correct: 1, category: "ciencias" },
    { question: "¿Cuál es el elemento más pesado que ocurre naturalmente?", options: ["Uranio", "Plutonio", "Plomo", "Oro"], correct: 0, category: "ciencias" },
    { question: "¿En qué año comenzó la Primera Guerra Mundial?", options: ["1912", "1913", "1914", "1915"], correct: 2, category: "historia" },
    { question: "¿Cuál es la constante de Planck aproximadamente?", options: ["6.626 × 10⁻³⁴ J·s", "3.141 × 10⁻³⁴ J·s", "9.806 × 10⁻³⁴ J·s", "2.718 × 10⁻³⁴ J·s"], correct: 0, category: "fisica" },
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
  matematicas: "🔢",
  ciencias: "🔬",
  historia: "📚",
  geografia: "🌍",
  arte: "🎨",
  literatura: "📖",
  animales: "�",
  musica: "🎵",
  fisica: "⚛️"
};

module.exports = {
  QUIZ_BANK,
  QUIZ_PRIZES,
  QUIZ_CATEGORIES
};
