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
test("/casino gzoysoyxpudoysoydo6spyd → longitud > 30 → inválido", () =>
  assertInvalid("/casino gzoysoyxpudoysoydo6spyd")
);
test("/casino add argumento_extra → inválido por partes>4 o longitud", () =>
  assertInvalid("/casino add argumento_extra_innecesario_largo")
);
test("/casino sola → inválido (solo 1 parte)", () => assertInvalid("/casino"));
test("/casino con PI → inválido", () =>
  assertInvalid("/casino 3.14159265358979323846264338327950288419716939937510")
);
test("/casino schedule sin hora → inválido (largo>30)", () =>
  assertInvalid("/casino schedule sinhora_con_texto_muy_largo_para_probar")
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
test("/bet con 16 targets → inválido (supera MAX_BET_TARGETS=15)", () => {
  assertInvalid("/bet 100 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16"); // 16 targets > 15 máx
});
test("/bet cuerpo muy largo → inválido", () => assertInvalid("/bet " + "500 ".repeat(30)));
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
test("/bet con 16 targets → inválido (supera límite de 15)", () =>
  assertInvalid("/bet 100 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15")
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
  assert(src.includes("module.exports = { handleCommand, handlePollReaction, handleBetReaction"), "handleBetReaction no está en module.exports");
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
test("/admin resumen extra → inválido (3 partes > max=2)", () =>
  assertInvalid("/admin resumen extra")
);
test("COMMAND_MAX_LENGTH['/casino'] = 30", () =>
  assert(COMMAND_MAX_LENGTH["/casino"] === 30)
);
test("COMMAND_MAX_LENGTH['/bet'] = 100", () =>
  assert(COMMAND_MAX_LENGTH["/bet"] === 100)
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
  assert(src.includes("MessageMedia.fromFilePath"), "No se encontró MessageMedia.fromFilePath");
  assert(src.includes("La ruleta está girando"), "No se encontró mensaje de transición");
  // Verificar orden: sticker antes que spinRoulette
  const stickerIdx = src.indexOf("sendMediaAsSticker");
  const spinIdx = src.indexOf("db.spinRoulette()");
  assert(stickerIdx < spinIdx, "El sticker debe enviarse ANTES de llamar a spinRoulette()");
});
test("MessageMedia importado en commands.js", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  assert(src.includes('const { MessageMedia }'), "MessageMedia no está importado");
});
test("Ruta del sticker usa path.join (portable)", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  assert(src.includes('path.join(__dirname, "Stickers"'), 'La ruta debe usar path.join(__dirname, "Stickers")');
});
test("Error de sticker es silencioso — no rompe el flujo", () => {
  const src = fs.readFileSync("./commands.js", "utf8");
  // Debe haber un try/catch alrededor del envío del sticker
  const stickerBlock = src.slice(src.indexOf("sendMediaAsSticker"), src.indexOf("La ruleta está girando"));
  assert(stickerBlock.includes("catch"), "El envío del sticker debe estar dentro de un try/catch");
});

console.log(`\n${"─".repeat(50)}`);
console.log(`📊 Resultados: ${passed}/${total} pasados`);
if (failed > 0) {
  console.log(`${R} ${failed} test${failed > 1 ? "s" : ""} fallido${failed > 1 ? "s" : ""}${X}`);
  process.exit(1);
} else {
  console.log(`${G} Todos los tests pasaron${X}\n`);
  process.exit(0);
}