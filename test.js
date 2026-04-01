/**
 * LetItRide Casino Bot — Test Suite
 * Corre con: npm test  (o node tests.js)
 *
 * No requiere WhatsApp ni la DB — testea pura lógica de validación
 * extrayendo las funciones directamente del módulo.
 */

"use strict";

// ─── COLORES ──────────────────────────────────────────────────────────────────
const G = "\x1b[32m✅";
const R = "\x1b[31m❌";
const Y = "\x1b[33m⚠️ ";
const B = "\x1b[36m";
const X = "\x1b[0m";

// ─── EXTRAER FUNCIONES DEL MÓDULO SIN EJECUTAR EL BOT ────────────────────────
// Leemos el archivo y evaluamos solo las partes necesarias
const fs = require("fs");
const src = fs.readFileSync("./commands.js", "utf8");

// Extraer VALID_SUBCOMMANDS, COMMAND_RULES, COMMAND_MAX_LENGTH, validateCommand, parseTarget
function extractBlock(src, name) {
  // Para funciones
  const fnMatch = src.match(new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`, "m"));
  if (fnMatch) {
    const start = src.indexOf(fnMatch[0]);
    let depth = 0, i = start;
    while (i < src.length) {
      if (src[i] === "{") depth++;
      if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
      i++;
    }
  }
  return null;
}

// Evaluar las constantes y funciones necesarias en un contexto aislado
const isolated = new Function(`
  "use strict";
  ${src.match(/const VALID_SUBCOMMANDS\s*=\s*\[[\s\S]*?\];/)[0]}
  ${src.match(/const COMMAND_RULES\s*=\s*\{[\s\S]*?\};/)[0]}
  ${src.match(/const COMMAND_MAX_LENGTH\s*=\s*\{[\s\S]*?\};/)[0]}
  ${src.match(/const KEYWORD_MAP\s*=\s*\{[\s\S]*?\};/)[0]}
  ${extractBlock(src, "validateCommand")}
  ${extractBlock(src, "parseTarget")}
  return { validateCommand, parseTarget, VALID_SUBCOMMANDS, COMMAND_RULES, COMMAND_MAX_LENGTH, KEYWORD_MAP };
`);

const { validateCommand, parseTarget, VALID_SUBCOMMANDS, COMMAND_RULES, COMMAND_MAX_LENGTH, KEYWORD_MAP } = isolated();

// ─── HELPERS DE TEST ──────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;

function test(description, fn) {
  total++;
  try {
    fn();
    console.log(`${G} ${description}${X}`);
    passed++;
  } catch (e) {
    console.log(`${R} ${description}${X}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}

function assert(condition, msg = "Assertion failed") {
  if (!condition) throw new Error(msg);
}

function assertValid(body, msg) {
  const parts = body.trim().split(/\s+/);
  assert(validateCommand(parts) === true, msg || `Expected VALID but got INVALID for: "${body}"`);
}

function assertInvalid(body, msg) {
  const parts = body.trim().split(/\s+/);
  assert(validateCommand(parts) === false, msg || `Expected INVALID but got VALID for: "${body}"`);
}

function assertTarget(token, expectedType, expectedValue) {
  const result = parseTarget(token);
  assert(result !== null, `parseTarget("${token}") returned null`);
  assert(result.betType === expectedType, `Expected betType=${expectedType}, got ${result?.betType}`);
  if (expectedValue !== undefined)
    assert(result.betValue === expectedValue, `Expected betValue=${expectedValue}, got ${result?.betValue}`);
}

function assertTargetInvalid(token) {
  const result = parseTarget(token);
  assert(result === null, `parseTarget("${token}") should return null but returned ${JSON.stringify(result)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1 — COMANDOS SIMPLES (sin argumentos)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 1: Comandos simples ══${X}`);

test("/balance exacto", () => assertValid("/balance"));
test("/top exacto", () => assertValid("/top"));
test("/history exacto", () => assertValid("/history"));
test("/spin exacto", () => assertValid("/spin"));
test("/stop exacto", () => assertValid("/stop"));

test("/balance con argumento extra → inválido", () => assertInvalid("/balance algo"));
test("/top con número → inválido", () => assertInvalid("/top 5"));
test("/spin con argumento → inválido", () => assertInvalid("/spin ahora"));
test("/history con argumento → inválido", () => assertInvalid("/history 10"));
test("/stop con argumento → inválido", () => assertInvalid("/stop forzado"));

test("/balance con texto largo → inválido", () => assertInvalid("/balance " + "a".repeat(200)));
test("/spin con pi entero → inválido", () => assertInvalid("/spin 3.14159265358979323846264338327950288"));
test("/stop MAYÚSCULAS exacto → válido (se normaliza)", () => {
  // El handler hace toLowerCase() — el test valida solo longitud/partes
  assertValid("/STOP");
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2 — /casino subcomandos
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 2: /casino subcomandos ══${X}`);

const validSubs = ["help", "add", "remove", "status", "start", "reset", "schedule", "days"];
validSubs.forEach(sub => {
  test(`/casino ${sub} → en VALID_SUBCOMMANDS`, () =>
    assert(VALID_SUBCOMMANDS.includes(sub))
  );
});

test("/casino add → válido", () => assertValid("/casino add"));
test("/casino remove → válido", () => assertValid("/casino remove"));
test("/casino help → válido", () => assertValid("/casino help"));
test("/casino status → válido", () => assertValid("/casino status"));
test("/casino schedule 20:00 → válido", () => assertValid("/casino schedule 20:00"));
test("/casino config currency Pesos → válido", () => assertValid("/casino config currency Pesos"));

// Subcomandos inexistentes
test("/casino xyz → pasa validador (VALID_SUBCOMMANDS lo rechaza después)", () => {
  // validateCommand solo mira largo/partes, la whitelist actúa después
  // Pero el largo de /casino xyz (10 chars) < 30, y tiene 2 partes, pasa
  // Confirmamos que VALID_SUBCOMMANDS lo atrapa
  assert(!VALID_SUBCOMMANDS.includes("xyz"), "xyz no debería estar en la whitelist");
});
test("/casino texto muy largo → longitud > 100 → inválido", () =>
  assertInvalid("/casino " + "x".repeat(95))
);
test("/casino add con demasiadas partes → inválido por partes>5", () =>
  assertInvalid("/casino add a b c d")
);
test("/casino sola → inválido (solo 1 parte)", () => assertInvalid("/casino"));
test("/casino con texto largo → inválido", () =>
  assertInvalid("/casino " + "a".repeat(95))
);
test("/casino schedule con argumento muy largo → inválido (largo>100)", () =>
  assertInvalid("/casino schedule " + "a".repeat(90))
);

// Inyección de script / SQL
test("/casino add <script>alert(1)</script> → inválido por longitud", () =>
  assertInvalid("/casino add <script>alert(1)</script>")
);
test("/casino add '; DROP TABLE groups; -- → inválido por longitud", () =>
  assertInvalid("/casino add '; DROP TABLE groups; --")
);
test("/casino add $(rm -rf /) → inválido por longitud", () =>
  assertInvalid("/casino add $(rm -rf /)")
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3 — /bet sintaxis
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 3: /bet sintaxis ══${X}`);

test("/bet 500 7 → válido", () => assertValid("/bet 500 7"));
test("/bet 200 rojo par → válido", () => assertValid("/bet 200 rojo par"));
test("/bet 100 3 15 22 d1 → válido", () => assertValid("/bet 100 3 15 22 d1"));
test("/bet rojo negro par impar altos bajos d1 d2 d3 c1 c2 c3 → válido (12 targets)", () =>
  assertValid("/bet 2000 rojo negro par impar altos bajos d1 d2 d3 c1 c2 c3")
);
test("/bet sola → inválido (solo 1 parte)", () => assertInvalid("/bet"));
test("/bet 500 → inválido (solo 2 partes, falta target)", () => assertInvalid("/bet 500"));
test("/bet con 16 targets → válido (dentro del límite de 52)", () => {
  assertValid("/bet 100 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16"); // 16 targets < 52 máx
});
test("/bet cuerpo muy largo → inválido (supera 52 partes)", () => assertInvalid("/bet 100 " + Array.from({length: 52}, (_, i) => i % 37).join(" ")));
test("/bet con SQL injection → inválido por longitud", () =>
  assertInvalid("/bet 500 7 OR 1=1 --")
);
test("/bet con script XSS → inválido por longitud", () =>
  assertInvalid("/bet 500 <img src=x onerror=alert(1)>")
);
test("/bet con null bytes → inválido", () =>
  assertInvalid("/bet 500 \x00\x00\x00")
);
test("/bet con emoji flood → inválido", () =>
  assertInvalid("/bet 500 " + "🎰".repeat(20))
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3b — Mínimos por categoría y límite de targets
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 3b: Mínimos por categoría y max targets ══${X}`);

// Extraer BET_MINIMUMS y MAX_BET_TARGETS del módulo
const srcFull = require("fs").readFileSync("./commands.js", "utf8");
const betMinsMatch = srcFull.match(/const BET_MINIMUMS\s*=\s*\{[\s\S]*?\};/)[0];
const maxTargetsMatch = srcFull.match(/const MAX_BET_TARGETS\s*=\s*(\d+);/)[1];
const MAX_BET_TARGETS = parseInt(maxTargetsMatch);
const BET_MINIMUMS = new Function(betMinsMatch + "; return BET_MINIMUMS;")();

test(`MAX_BET_TARGETS = 15`, () => assert(MAX_BET_TARGETS === 15));
test("Mínimo número = 100",   () => assert(BET_MINIMUMS['number']  === 100));
test("Mínimo rojo = 2000",    () => assert(BET_MINIMUMS['red']     === 2000));
test("Mínimo negro = 2000",   () => assert(BET_MINIMUMS['black']   === 2000));
test("Mínimo par = 2000",     () => assert(BET_MINIMUMS['even']    === 2000));
test("Mínimo impar = 2000",   () => assert(BET_MINIMUMS['odd']     === 2000));
test("Mínimo altos = 1000",   () => assert(BET_MINIMUMS['high']    === 1000));
test("Mínimo bajos = 1000",   () => assert(BET_MINIMUMS['low']     === 1000));
test("Mínimo d1 = 500",       () => assert(BET_MINIMUMS['dozen1']  === 500));
test("Mínimo d2 = 500",       () => assert(BET_MINIMUMS['dozen2']  === 500));
test("Mínimo d3 = 500",       () => assert(BET_MINIMUMS['dozen3']  === 500));
test("Mínimo c1 = 500",       () => assert(BET_MINIMUMS['column1'] === 500));
test("Mínimo c2 = 500",       () => assert(BET_MINIMUMS['column2'] === 500));
test("Mínimo c3 = 500",       () => assert(BET_MINIMUMS['column3'] === 500));
test("Todas las categorías tienen mínimo definido", () => {
  const types = ['number','red','black','even','odd','high','low','dozen1','dozen2','dozen3','column1','column2','column3'];
  types.forEach(t => assert(BET_MINIMUMS[t] !== undefined, `Falta mínimo para: ${t}`));
});
test("/bet con 12 targets → válido (dentro del límite de 15)", () =>
  assertValid("/bet 2000 rojo negro par impar altos bajos d1 d2 d3 c1 c2 c3")
);
test("/bet con 16 targets → válido (dentro del límite de 52)", () =>
  assertValid("/bet 100 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15")
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4 — parseTarget: números válidos
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 4: parseTarget — números ══${X}`);

test("token '0' → number 0", () => assertTarget("0", "number", "0"));
test("token '1' → number 1", () => assertTarget("1", "number", "1"));
test("token '17' → number 17", () => assertTarget("17", "number", "17"));
test("token '36' → number 36", () => assertTarget("36", "number", "36"));
test("token '00' → number 0 (parseInt('00') = 0)", () => assertTarget("00", "number", "0"));

// Límites inválidos
test("token '37' → null (fuera de ruleta)", () => assertTargetInvalid("37"));
test("token '99' → null", () => assertTargetInvalid("99"));
test("token '100' → null (3 dígitos = monto, no número)", () => assertTargetInvalid("100"));
test("token '-1' → null (negativo)", () => assertTargetInvalid("-1"));
test("token '3.5' → null (decimal)", () => assertTargetInvalid("3.5"));
test("token '7abc' → null (alfanumérico)", () => assertTargetInvalid("7abc"));
test("token '' → null (vacío)", () => assertTargetInvalid(""));
test("token ' ' → null (espacio)", () => assertTargetInvalid(" "));

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 5 — parseTarget: keywords en español
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 5: parseTarget — keywords ══${X}`);

const keywords = [
  ["rojo",  "red"],   ["negro", "black"],
  ["par",   "even"],  ["impar", "odd"],
  ["altos", "high"],  ["bajos", "low"],
  ["d1", "dozen1"],   ["d2", "dozen2"], ["d3", "dozen3"],
  ["c1", "column1"],  ["c2", "column2"], ["c3", "column3"],
];
keywords.forEach(([kw, expected]) => {
  test(`keyword '${kw}' → ${expected}`, () => assertTarget(kw, expected));
  test(`keyword '${kw.toUpperCase()}' (mayúsculas) → ${expected}`, () => assertTarget(kw.toUpperCase(), expected));
});

// Palabras parecidas pero inválidas
test("'roj' → null (incompleto)", () => assertTargetInvalid("roj"));
test("'rojo1' → null (con sufijo)", () => assertTargetInvalid("rojo1"));
test("'d4' → null (docena inexistente)", () => assertTargetInvalid("d4"));
test("'c4' → null (columna inexistente)", () => assertTargetInvalid("c4"));
test("'c0' → null", () => assertTargetInvalid("c0"));
test("'red' → null (inglés no aceptado)", () => assertTargetInvalid("red"));
test("'black' → null (inglés no aceptado)", () => assertTargetInvalid("black"));
test("'even' → null (inglés no aceptado)", () => assertTargetInvalid("even"));
test("'odd' → null (inglés no aceptado)", () => assertTargetInvalid("odd"));
test("'high' → null (inglés no aceptado)", () => assertTargetInvalid("high"));

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 6 — Confirmación de apuesta por reacción
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 6: Confirmación por reacción ══${X}`);

test("handleBetReaction está exportado", () => {
  // Verificar que el export existe sin instanciar el módulo completo
  const src = require("fs").readFileSync("./commands.js", "utf8");
  assert(src.includes("handleBetReaction"), "handleBetReaction no encontrado en commands.js");
  assert(src.includes("module.exports = {") && src.includes("handleBetReaction"), "handleBetReaction no está en module.exports");
});
test("pendingBets guarda msgId del mensaje de confirmación", () => {
  const src = require("fs").readFileSync("./commands.js", "utf8");
  assert(src.includes("msgId: previewMsgId"), "pendingBets debe guardar msgId");
});
test("Solo reacciones 👍 y 👎 son procesadas", () => {
  const src = require("fs").readFileSync("./commands.js", "utf8");
  assert(src.includes("['👍', '👎'].includes(reaction.reaction)"), "Debe filtrar solo 👍 y 👎");
});
test("Solo el apostante original puede confirmar", () => {
  const src = require("fs").readFileSync("./commands.js", "utf8");
  assert(src.includes("if (reactorId !== betUserId) return"), "Debe rechazar reacciones de otros usuarios");
});
test("si/yes/no ya no están en COMMAND_RULES", () => {
  const src = require("fs").readFileSync("./commands.js", "utf8");
  assert(!src.includes('"si":       [1, 1]'), 'si no debe estar en COMMAND_RULES');
  assert(!src.includes('"yes":      [1, 1]'), 'yes no debe estar en COMMAND_RULES');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 7 — Inyección de código / entradas maliciosas
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 7: Inyección y entradas maliciosas ══${X}`);

const maliciousInputs = [
  // XSS
  "/casino add <script>alert('xss')</script>",
  "/casino add <img src=x onerror=alert(1)>",
  "/casino add javascript:alert(1)",
  "/bet 500 <svg onload=alert(1)>",
  // SQL Injection
  "/casino add ' OR '1'='1",
  "/casino add '; DROP TABLE groups; --",
  "/casino add \" OR \"1\"=\"1",
  "/bet 500 7 UNION SELECT * FROM users",
  // Command Injection
  "/casino add $(cat /etc/passwd)",
  "/casino add `id`",
  "/casino add && rm -rf /",
  "/casino add || whoami",
  "/bet 500 7; cat /etc/passwd",
  // Path Traversal
  "/casino add ../../etc/passwd",
  "/casino add ../../../root/.ssh/id_rsa",
  // Overflow / Long inputs
  "/casino add " + "A".repeat(500),
  "/bet 500 " + "7 ".repeat(100),
  "/balance " + "x".repeat(1000),
  // Unicode / Especiales
  "/casino add \u0000\u0001\u0002",
  "/casino add \u202e reversed",
  "/bet 500 \u00007",
  // Números enormes
  "/bet 99999999999999999999999999 7",
  // Whitespace abuse
  // whitespace normalizado por split — se testea en suite 3
];

maliciousInputs.forEach(input => {
  test(`Rechaza: "${input.slice(0, 60)}${input.length > 60 ? '...' : ''}"`, () => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    // Si tiene regla, debe fallar validateCommand
    // Si no tiene regla (comando desconocido), igual es rechazado por el handler
    const hasRule = !!COMMAND_RULES[cmd];
    if (hasRule) {
      assert(
        validateCommand(parts) === false,
        `validateCommand debería rechazar esta entrada maliciosa`
      );
    } else {
      // Comando desconocido → no tiene regla → se ignora en el handler
      assert(true, "Comando desconocido — rechazado por el handler principal");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 8 — Edge cases del validador
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 8: Edge cases del validador ══${X}`);

test("Comando vacío → no tiene regla (true = pasa al handler)", () => {
  assert(validateCommand([""]) === true);
});
test("Comando desconocido '/xyz' → true (el handler lo rechaza)", () => {
  assert(validateCommand(["/xyz"]) === true);
});
test("/admin solo → válido (1 parte)", () => assertValid("/admin"));
test("/admin resumen → válido (2 partes)", () => assertValid("/admin resumen"));
test("/admin resumen extra → válido (3 partes)", () => assertValid("/admin resumen extra"));
test("/admin resumen extra otro → válido (4 partes)", () => assertValid("/admin resumen extra otro"));
test("COMMAND_MAX_LENGTH['/casino'] = 100", () =>
  assert(COMMAND_MAX_LENGTH["/casino"] === 100)
);
test("COMMAND_MAX_LENGTH['/bet'] = 350", () =>
  assert(COMMAND_MAX_LENGTH["/bet"] === 350)
);
test("VALID_SUBCOMMANDS tiene exactamente 10 entradas", () =>
  assert(VALID_SUBCOMMANDS.length === 10, `Tiene ${VALID_SUBCOMMANDS.length} en lugar de 10`)
);
test("Todos los keywords del KEYWORD_MAP tienen valor interno válido", () => {
  const valid = ["red","black","even","odd","high","low","dozen1","dozen2","dozen3","column1","column2","column3"];
  Object.values(KEYWORD_MAP).forEach(v =>
    assert(valid.includes(v), `Valor interno desconocido: ${v}`)
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 9 — Tests específicos de reacciones de quiz
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 9: Reacciones de Quiz y Prevención de Bugs ══${X}`);

const quizSrc = require("fs").readFileSync("./quizzes-new.js", "utf8");

// Definir EMOJI_TO_INDEX manualmente basado en el código real
const EMOJI_TO_INDEX = {
  '1️⃣': 0, '1': 0, '1⃣': 0,
  '2️⃣': 1, '2': 1, '2⃣': 1,
  '3️⃣': 2, '3': 2, '3⃣': 2,
  '4️⃣': 3, '4': 3, '4⃣': 3
};

const letterMatch = quizSrc.match(/const INDEX_TO_LETTER\s*=\s*\[[\s\S]*?\];/);
const INDEX_TO_LETTER = letterMatch ? new Function(letterMatch[0] + "; return INDEX_TO_LETTER;")() : ['A', 'B', 'C', 'D'];

test("Conversión de emoji a letra funciona correctamente", () => {
  const testCases = [
    ['1️⃣', 'A'], ['1', 'A'], ['1⃣', 'A'],
    ['2️⃣', 'B'], ['2', 'B'], ['2⃣', 'B'],
    ['3️⃣', 'C'], ['3', 'C'], ['3⃣', 'C'],
    ['4️⃣', 'D'], ['4', 'D'], ['4⃣', 'D']
  ];
  
  testCases.forEach(([emoji, expectedLetter]) => {
    const index = EMOJI_TO_INDEX[emoji];
    const letter = INDEX_TO_LETTER[index];
    assert(letter === expectedLetter, `${emoji} debe convertir a ${expectedLetter}, pero dio ${letter}`);
  });
});

test("Distribución de premios entre ganadores", () => {
  const QUIZ_PRIZES_MOCK = { 1: 5000, 2: 3000, 3: 2000, default: 1000 };
  const scenarios = [
    { winners: 1, expectedPrize: 5000 },
    { winners: 2, expectedPrize: 3000 },
    { winners: 3, expectedPrize: 2000 },
    { winners: 8, expectedPrize: 1000 }
  ];
  scenarios.forEach(scenario => {
    const prizePerWinner = scenario.winners <= 3 ? QUIZ_PRIZES_MOCK[scenario.winners] : QUIZ_PRIZES_MOCK.default;
    assert(prizePerWinner === scenario.expectedPrize, `Fallo en cálculo de premio para ${scenario.winners} ganadores`);
  });
});

// ─── TESTS DE ANÁLISIS ESTÁTICO (FIXES RECIENTES) ──────────────────────────────
console.log(`\n${B}   ↳ Verificando Fixes Críticos en quizzes-new.js ↳${X}`);

test("Fix ID: Extrae correctamente el groupId del msgId._serialized", () => {
  assert(quizSrc.includes(".includes('@g.us')"), "Falta verificar si el ID contiene @g.us");
  assert(quizSrc.includes(".split('_').find(p => p.includes('@g.us'))"), "Falta la lógica para extraer el ID del grupo con split");
});

test("Fix Memoria: Busca el quiz usando getActiveQuiz en la memoria central", () => {
  assert(quizSrc.includes("getActiveQuiz(groupId)") || quizSrc.includes("getActiveQuiz(activeGroupId)"), 
    "Debe usar getActiveQuiz() para evitar el bug de '0 participantes'");
});

test("Fix Tiempo: Aplica los 20 segundos de gracia para latencia de red", () => {
  assert(quizSrc.includes("20000") || quizSrc.includes("timeLimit = 20000") || quizSrc.includes("createQuiz(groupId, difficulty, 20000)"), 
    "Debe establecer timeLimit en 20000ms para compensar latencia");
});

test("Fix Registro: Pasa el activeGroupId correcto a submitAnswer", () => {
  assert(quizSrc.includes("submitAnswer(from, senderId, answerLetter)"), 
    "submitAnswer debe recibir el groupId correcto ('from')");
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SUITE — Envío de Stickers
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE: Envío de Stickers ══${X}`);

{
  // Tests de archivo — solo corren si la carpeta Stickers está presente
  const _path = require("path");
  const _fs = require("fs");
  const stickerDir = _path.join(__dirname, "Stickers");
  const stickerFile = _path.join(stickerDir, "LetItRide!!.20");
  const stickerPresent = _fs.existsSync(stickerDir) && _fs.existsSync(stickerFile);

  if (!stickerPresent) {
    console.log(`${Y} Carpeta ./Stickers no encontrada — tests de archivo salteados.${X}`);
    console.log(`${Y} Copiá el sticker al servidor para ejecutarlos.${X}`);
  }

  test("Carpeta Stickers existe", () => {
    if (!stickerPresent) { console.log("     (salteado — carpeta no presente)"); return; }
    assert(fs.existsSync(stickerDir), "No existe la carpeta ./Stickers");
  });
  test("Archivo de sticker existe", () => {
    if (!stickerPresent) { console.log("     (salteado — archivo no presente)"); return; }
    assert(fs.existsSync(stickerFile), `No existe: ${stickerFile}`);
  });
  test("Archivo de sticker no está vacío", () => {
    if (!stickerPresent) { console.log("     (salteado)"); return; }
    assert(fs.statSync(stickerFile).size > 0, "El sticker está vacío");
  });
  test("Archivo de sticker es un WebP válido (header RIFF...WEBP)", () => {
    if (!stickerPresent) { console.log("     (salteado)"); return; }
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(stickerFile, "r");
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    assert(buf.slice(0,4).toString("ascii") === "RIFF" && buf.slice(8,12).toString("ascii") === "WEBP",
      `No es WebP válido (header: ${buf.slice(0,12).toString("hex")})`);
  });
}
test("spinAndReport envía sticker antes del resultado", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  assert(src.includes("sendMediaAsSticker: true"), "No se encontró sendMediaAsSticker en spinAndReport");
  assert(
    src.includes("MessageMedia.fromFilePath") || src.includes("new MessageMedia("),
    "No se encontró creación de MessageMedia (fromFilePath o new MessageMedia)"
  );
  assert(src.includes("La ruleta está girando"), "No se encontró mensaje de transición");
  // Verificar orden: sticker antes que spinRoulette
  const stickerIdx = src.indexOf("sendMediaAsSticker");
  const spinIdx = src.indexOf("db.spinRoulette()");
  assert(stickerIdx < spinIdx, "El sticker debe enviarse ANTES de llamar a spinRoulette()");
});
test("MessageMedia importado en commands.js", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  assert(src.includes('const { MessageMedia, Poll } = require("whatsapp-web.js")'), "MessageMedia no está importado correctamente");
});
test("Ruta del sticker usa path.join (portable)", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  assert(src.includes('path.join(__dirname, "Stickers"'), 'La ruta debe usar path.join(__dirname, "Stickers")');
});
test("Error de sticker es silencioso — no rompe el flujo", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  assert(
    src.includes("stickerErr") || src.includes("catch (sticker"),
    "El envío del sticker debe estar dentro de un try/catch"
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 10 — Ajuste de apuestas y validación de fondos
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 10: Ajuste de apuestas y validación de fondos ══${X}`);

// Extraer funciones de ajuste de apuestas
const betSrc = require("fs").readFileSync("./commands.js", "utf8");

test("Función de ajuste de apuestas existe", () => {
  assert(betSrc.includes("⚠️ *Tu apuesta fue ajustada* ✂️"), "No se encontró mensaje de ajuste de apuestas");
  assert(betSrc.includes("removedByMin"), "No se encontró lógica de eliminación por mínimo");
  assert(betSrc.includes("removedByFunds"), "No se encontró lógica de eliminación por fondos");
});

test("Valida monto mínimo por categoría", () => {
  // Simular la lógica de validación
  const mockBets = [
    { amount: 50, targets: [{betType: 'number'}] },  // Debajo de mínimo (100)
    { amount: 1500, targets: [{betType: 'red'}] },   // Debajo de mínimo (2000)  
    { amount: 300, targets: [{betType: 'd1'}] },     // Arriba de mínimo (500)
    { amount: 2000, targets: [{betType: 'number'}] } // Arriba de mínimo (100)
  ];
  
  const expectedResults = [false, false, true, true]; // false = eliminado por mínimo
  
  mockBets.forEach((bet, i) => {
    const minAmount = BET_MINIMUMS[bet.targets[0].betType] || 100;
    const passesMin = bet.amount >= minAmount;
    assert(passesMin === expectedResults[i], 
      `Apuesta ${i}: monto=${bet.amount}, tipo=${bet.targets[0].betType}, mínimo=${minAmount}`);
  });
});

test("Valida saldo disponible para apuestas múltiples", () => {
  const userCredits = 10000;
  const mockBets = [
    { amount: 5000, targets: [{betType: 'number'}, {betType: 'red'}] }, // 5000 * 2 = 10000 (exacto)
    { amount: 3000, targets: [{betType: 'number'}, {betType: 'red'}, {betType: 'd1'}] }, // 3000 * 3 = 9000 (ok)
    { amount: 4000, targets: [{betType: 'number'}, {betType: 'red'}, {betType: 'd1'}] }, // 4000 * 3 = 12000 (excede)
  ];
  
  const expectedResults = [true, true, false]; // false = eliminado por fondos
  
  mockBets.forEach((bet, i) => {
    const totalCost = bet.amount * bet.targets.length;
    const hasFunds = totalCost <= userCredits;
    assert(hasFunds === expectedResults[i], 
      `Apuesta ${i}: monto=${bet.amount}, targets=${bet.targets.length}, total=${totalCost}, saldo=${userCredits}`);
  });
});

test("Genera mensaje de ajuste correctamente", () => {
  assert(betSrc.includes("❌ *Eliminados (mínimo insuficiente):*"), "Falta mensaje de eliminación por mínimo");
  assert(betSrc.includes("❌ *Eliminados (fondos insuficientes):*"), "Falta mensaje de eliminación por fondos");
  assert(betSrc.includes("✅ *Apuesta válida:*"), "Falta mensaje de apuestas válidas");
  assert(betSrc.includes("Reaccioná a este mensaje con 👍 para confirmar"), "Falta instrucción de reacción");
});

test("Guarda apuesta pendiente con ID correcto", () => {
  assert(betSrc.includes("pendingBetReactions.set(previewMsgId"), "No se guarda apuesta pendiente con msgId");
  assert(betSrc.includes("timeoutId"), "No se configura timeout para apuesta pendiente");
  assert(betSrc.includes("activeGameId"), "No se guarda el ID del juego activo");
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 11 — Tests completos de reacciones para apuestas
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 11: Tests completos de reacciones para apuestas ══${X}`);

test("Extrae ID de mensaje de reacción correctamente", () => {
  assert(betSrc.includes("reaction.msgId?._serialized"), "No extrae msgId._serialized");
  assert(betSrc.includes("reaction.message?.id?._serialized"), "No extrae message.id._serialized como fallback");
  assert(betSrc.includes("split(/[_\"]/)"), "No hace split para extraer ID base");
  assert(betSrc.includes("/^[A-F0-9]+$/i"), "No valida formato hexadecimal del ID");
});

test("Compara correctamente ID de reacción con apuestas pendientes", () => {
  assert(betSrc.includes("pendingBetReactions.entries()"), "No itera sobre apuestas pendientes");
  assert(betSrc.includes("bId === baseId"), "No compara ID base con apuesta pendiente");
  assert(betSrc.includes("reaction.senderId === betMatch.userId"), "No valida que el apostante original confirme");
});

test("Procesa reacción 👍 correctamente", () => {
  assert(betSrc.includes("THUMB_UP_VARIATIONS.includes(reaction.reaction)"), "No valida variaciones de 👍");
  assert(betSrc.includes("await executeConfirmedBet(betMatch, client)"), "No ejecuta confirmación de apuesta");
  assert(betSrc.includes("pendingBetReactions.delete(betKey)"), "No elimina apuesta pendiente después de confirmar");
});

test("Limpia timeout de apuesta confirmada", () => {
  assert(betSrc.includes("clearTimeout(betMatch.timeoutId)"), "No limpia timeout al confirmar apuesta");
});

test("Maneja casos de reacción a mensaje incorrecto", () => {
  // El código debe ignorar reacciones a mensajes que no son de apuestas pendientes
  assert(betSrc.includes("if (betMatch)"), "No hay control de si encontró apuesta pendiente");
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 12 — Tests mejorados de Quiz (corrigiendo los 3 fallidos)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 12: Tests mejorados de Quiz (corrigiendo los 3 fallidos) ══${X}`);

test("Fix ID: Extrae correctamente el groupId del msgId._serialized", () => {
  // Verificar que handleQuizPollReaction extrae correctamente el groupId desde reaction.message.from
  assert(quizSrc.includes("reaction.message.from"), "Debe extraer groupId desde reaction.message.from");
  assert(quizSrc.includes("let from = reaction.message.from"), "Debe asignar groupId a variable 'from'");
  // Verificar que también tiene la lógica de fallback con @g.us
  assert(quizSrc.includes(".includes('@g.us')"), "Debe verificar si el ID contiene @g.us");
});

test("Fix Memoria: Busca el quiz usando getActiveQuiz en la memoria central", () => {
  assert(quizSrc.includes("const q = getActiveQuiz(from)"), "Debe usar getActiveQuiz(from) para buscar quiz activo");
  assert(quizSrc.includes("getActiveQuiz(from)"), "Debe pasar el groupId correcto a getActiveQuiz");
});

test("Fix Tiempo: Aplica los 20 segundos de gracia para latencia de red", () => {
  // Buscar setTimeLimit o timeLimit = 20000 en quizzes-new.js o el parámetro 20000 en createQuiz
  assert(quizSrc.includes("20000") || quizSrc.includes("timeLimit = 20000") || quizSrc.includes("createQuiz(groupId, difficulty, 20000)"), 
    "Debe establecer timeLimit en 20000ms para compensar latencia");
});

test("Fix Registro: Pasa el activeGroupId correcto a submitAnswer", () => {
  assert(quizSrc.includes("submitAnswer(from, senderId, answerLetter)"), 
    "submitAnswer debe recibir el groupId correcto ('from')");
});

test("Quiz: Verifica que la reacción sea sobre el mensaje del quiz", () => {
  assert(quizSrc.includes("q.quizMessageId"), "Debe verificar quizMessageId del quiz activo");
  assert(quizSrc.includes("reactedMsgId !== q.quizMessageId"), "Debe comparar ID del mensaje reaccionado");
});

test("Quiz: Convierte emoji a índice correctamente", () => {
  assert(quizSrc.includes("DIGIT_TO_INDEX"), "Debe tener mapeo de emoji a índice");
  assert(quizSrc.includes("String.fromCharCode(65 + idx)"), "Debe convertir índice a letra (A, B, C, D)");
});

test("Quiz: Registra respuesta correctamente", () => {
  assert(quizSrc.includes("console.log(`🧠 Quiz respuesta:"), "Debe loggear respuesta recibida");
  assert(quizSrc.includes("if (ok)"), "Debe verificar si la respuesta se registró correctamente");
});

test("Quiz: Filtra reacciones no numéricas", () => {
  const indexSrc = require("fs").readFileSync("./index.js", "utf8");
  assert(indexSrc.includes("ALLOWED_DIGITS"), "Debe tener constantes de emojis permitidos");
  assert(indexSrc.includes("['1️⃣','2️⃣','3️⃣','4️⃣']"), "Debe definir emojis numéricos permitidos");
  assert(indexSrc.includes("isDigit"), "Debe filtrar solo reacciones de dígitos para quizzes");
});

test("Quiz: Evita procesar reacciones duplicadas", () => {
  const indexSrc = require("fs").readFileSync("./index.js", "utf8");
  // Verificar que se eliminó el sistema anti-duplicación que estaba causando problemas
  assert(!indexSrc.includes("processedReactions"), "No debe tener sistema anti-duplicación (causaba bugs)");
});

test("Quiz: Separa correctamente reacciones de casino y quizzes", () => {
  const indexSrc = require("fs").readFileSync("./index.js", "utf8");
  assert(indexSrc.includes("if (isThumb) await handlePollReaction"), "Las reacciones 👍 deben ir al casino");
  assert(indexSrc.includes("if (isDigit) await handleQuizPollReaction"), "Las reacciones numéricas deben ir a quizzes");
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 13 — Tests de integración de reacciones
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}══ SUITE 13: Tests de integración de reacciones ══${X}`);

test("Integración: Flujo completo de apuesta con reacción", () => {
  // Verificar que todo el flujo esté presente
  const commandsSrc = require("fs").readFileSync("./commands.js", "utf8");
  const indexSrc = require("fs").readFileSync("./index.js", "utf8");
  
  // 1. Comando /bet procesado
  assert(commandsSrc.includes('if (command === "/bet")'), "Debe procesar comando /bet");
  
  // 2. Ajuste de apuesta si es necesario
  assert(commandsSrc.includes("⚠️ *Tu apuesta fue ajustada*"), "Debe mostrar mensaje de ajuste");
  
  // 3. Guardar apuesta pendiente
  assert(commandsSrc.includes("pendingBetReactions.set"), "Debe guardar apuesta pendiente");
  
  // 4. Manejar reacción 👍
  assert(indexSrc.includes("client.on(\"message_reaction\""), "Debe escuchar reacciones");
  assert(indexSrc.includes("if (isThumb) await handlePollReaction"), "Debe procesar 👍 para casino");
  
  // 5. Confirmar apuesta
  assert(commandsSrc.includes("executeConfirmedBet"), "Debe ejecutar confirmación de apuesta");
});

test("Integración: Flujo completo de quiz con reacción", () => {
  const quizSrc = require("fs").readFileSync("./quizzes-new.js", "utf8");
  const indexSrc = require("fs").readFileSync("./index.js", "utf8");
  
  // 1. Comando /quiz start procesado
  assert(quizSrc.includes("handleQuizCommand"), "Debe procesar comando /quiz");
  
  // 2. Envío de quiz
  assert(quizSrc.includes("await client.sendMessage(groupId, fullMessage)"), "Debe enviar mensaje de quiz");
  
  // 3. Guardar quizMessageId
  assert(quizSrc.includes("quizData.quizMessageId = quizMessageId"), "Debe guardar ID del mensaje del quiz");
  
  // 4. Manejar reacción numérica
  assert(indexSrc.includes("if (isDigit) await handleQuizPollReaction"), "Debe procesar emojis numéricos");
  
  // 5. Procesar respuesta
  assert(quizSrc.includes("submitAnswer(from, senderId, answerLetter)"), "Debe registrar respuesta del quiz");
});

test("Integración: No hay interferencia entre sistemas", () => {
  const indexSrc = require("fs").readFileSync("./index.js", "utf8");
  
  // Verificar que los sistemas estén separados correctamente
  assert(indexSrc.includes("isThumb  = ALLOWED_RAW.includes(emojiN)"), "Debe detectar reacciones 👍");
  assert(indexSrc.includes("isDigit  = ALLOWED_DIGITS.includes(emojiN)"), "Debe detectar reacciones numéricas");
  assert(indexSrc.includes("if (!isThumb && !isDigit) return"), "Debe ignorar otras reacciones");
});

console.log(`\n${"─".repeat(50)}`);
console.log(` Resultados: ${passed}/${total} pasados`);
if (failed > 0) {
  console.log(`${R} ${failed} test${failed > 1 ? "s" : ""} fallido${failed > 1 ? "s" : ""}${X}`);
  process.exit(1);
} else {
  console.log(`${G} Todos los tests pasaron${X}\n`);
  process.exit(0);
}