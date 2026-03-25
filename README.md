# LetItRide Casino Bot 🎰

Un bot de WhatsApp de casino que ofrece ruleta en vivo con créditos semanales, apuestas simultáneas y juegos automáticos programados.

## 🎰 Características

- 🎲 **Ruleta de Casino Europea** (números 0-36)
- 💰 **Sistema de Créditos Semanales** automáticos
- 🕐 **Juegos Automáticos** programables por grupo
- 📊 **Panel Web** para administración y estadísticas
- 🏆 **Ranking de Jugadores** en tiempo real
- 🎮 **Apuestas Simultáneas** múltiples tipos de apuesta
- 📱 **Interfaz Amigable** con emojis y formato claro

## 📋 Requisitos

- Node.js 16+
- npm
- WhatsApp Web
- SQLite (incluido automáticamente)

## 🛠️ Instalación

1. **Navegar al directorio del proyecto:**
   ```bash
   cd LetItRide
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env
   ```
   
   Editar el archivo `.env` con tus configuraciones:
   ```
   GAME_SCHEDULE=20:00
   GAME_DAYS=1,3,5
   CHROMIUM_PATH=/usr/bin/chromium
   TUNNEL_URL=https://your-tunnel-url-here.com
   ```

## 🎮 Comandos del Casino

### 🎰 Administración del Casino (Solo Admins)
- `/casino add` - Activar el casino en el grupo
- `/casino remove` - Desactivar el casino
- `/casino start` - Iniciar nueva ronda de ruleta manual
- `/casino status` - Ver estado completo del casino
- `/casino config <clave> <valor>` - Configurar parámetros
- `/casino schedule <HH:MM>` - Horario de juegos automáticos
- `/casino days <días>` - Días de juego (ej: 1,3,5)
- `/casino credits <cantidad>` - Créditos semanales
- `/casino reset` - Resetear créditos manualmente

### 🎲 Juegos y Apuestas
- `/bet <tipo> <monto>` - Realizar apuesta
- `/bet number <número> <monto>` - Apostar a número específico
- `/bet red|black <monto>` - Apostar a color
- `/bet odd|even <monto>` - Apostar a par/impar
- `/bet low|high <monto>` - Apostar a rango (1-18/19-36)
- `/bet dozen1|2|3 <monto>` - Apostar a docenas
- `/bet column1|2|3 <monto>` - Apostar a columnas
- `/spin` - Girar la ruleta (solo admins)

### 💰 Gestión de Cuenta
- `/balance` - Ver tus créditos y estadísticas
- `/top` - Ver ranking de jugadores del grupo
- `/history` - Ver tu historial de transacciones

### 📊 Información
- `/casino help` - Ver ayuda completa

## 💡 Tipos de Apuesta y Pagos

| Tipo de Apuesta | Ejemplo | Pago | Descripción |
|----------------|---------|------|-------------|
| `number` | `/bet number 17 100` | 35:1 | Apostar a número específico (0-36) |
| `red/black` | `/bet red 50` | 1:1 | Apostar a color rojo o negro |
| `odd/even` | `/bet odd 25` | 1:1 | Apostar a impar o par |
| `low/high` | `/bet low 30` | 1:1 | Apostar a 1-18 o 19-36 |
| `dozen1/2/3` | `/bet dozen2 40` | 2:1 | Apostar a docenas (1-12, 13-24, 25-36) |
| `column1/2/3` | `/bet column1 40` | 2:1 | Apostar a columnas verticales |

## 🕐 Sistema de Juegos Automáticos

El bot puede iniciar juegos automáticamente según configuración:

- **Horario predeterminado:** 20:00 (8 PM)
- **Días predeterminados:** Lunes, Miércoles, Viernes (1,3,5)
- **Duración de apuestas:** 5 minutos
- **Reseteo semanal:** Lunes 00:00 (todos reciben créditos)

### Configurar Horarios
```bash
# Cambiar horario a las 22:30
/casino schedule 22:30

# Juegos todos los días
/casino days 0,1,2,3,4,5,6

# Solo fines de semana
/casino days 6,0
```

## 🌐 Panel Web de Administración

El bot incluye un panel web seguro para administradores:

1. Usa `/casino status` para obtener el enlace del panel
2. Recibirás una llave de acceso privada por mensaje directo
3. Accede al panel para:
   - Ver estadísticas del casino en tiempo real
   - Consultar ranking de jugadores
   - Monitorear juegos activos
   - Ver configuración del grupo

## 🗄️ Base de Datos

El bot utiliza SQLite para almacenar:
- Información de grupos y configuración
- Perfiles de jugadores y créditos
- Historial de juegos y apuestas
- Transacciones y estadísticas
- Tokens de seguridad para panel web

La base de datos se crea automáticamente en `letitride_casino.db`

## 🎛️ Configuración Avanzada

### Parámetros Configurables
```bash
# Cambiar moneda del casino
/casino config currency Fichas

# Ajustar límites de apuesta
/casino config min_bet 5
/casino config max_bet 1000

# Créditos semanales personalizados
/casino credits 2000
```

### Variables de Entorno
- `GAME_SCHEDULE`: Horario de juegos automáticos (default: 20:00)
- `GAME_DAYS`: Días de juego (default: 1,3,5)
- `CHROMIUM_PATH`: Ruta a Chromium para Puppeteer
- `TUNNEL_URL`: URL para tunnel externo (panel web)

## 🔄 Flujo de Juego Típico

1. **Activación:** Admin usa `/casino add`
2. **Créditos:** Sistema asigna créditos semanales automáticamente
3. **Juego Manual:** Admin usa `/casino start` o espera juego automático
4. **Apuestas:** Jugadores usan `/bet <tipo> <monto>`
5. **Cierre:** Admin usa `/spin` o automático después de 5 minutos
6. **Resultados:** Bot muestra ganadores y actualiza créditos

## 🛡️ Seguridad

- Tokens únicos por grupo para acceso al panel
- Validación de administradores para comandos sensibles
- Límites de apuesta configurables
- Protección contra spam y apuestas inválidas
- Registro completo de transacciones

## 🚀 Ejecución

### Desarrollo
```bash
npm start
```

### Producción (con PM2)
```bash
pm2 start index.js --name "letitride-casino-bot"
```

## 📱 Ejemplos de Uso

### Iniciar Casino
```bash
/casino add
/casino credits 1500
/casino schedule 21:00
/casino days 2,4,6
```

### Juego Típico
```bash
# Admin inicia juego
/casino start

# Jugadores apuestan
/bet red 100
/bet number 23 50
/bet odd 75
/bet dozen1 200

# Admin gira la ruleta
/spin
```

### Consultar Estado
```bash
# Ver balance personal
/balance

# Ver ranking
/top

# Ver estado del casino
/casino status
```

## 📝 Notas Técnicas

- El bot requiere escanear el QR la primera vez
- Las sesiones se guardan automáticamente
- El servidor web corre en el puerto 3000
- Compatible con grupos de WhatsApp
- Base de datos SQLite sin configuración requerida
- Timezone: America/Argentina/Buenos_Aires

## 🤂 Contribuir

Siéntete libre de sugerir mejoras, reportar issues o aportar código.

## 📄 Licencia

ISC