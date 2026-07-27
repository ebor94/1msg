#!/usr/bin/env bash
#
# Monitor de salud con auto-reparación. Pensado para correr cada minuto por cron.
#
#   * / 1 * * * *  /home/bortega/apps/wa/scripts/monitor-salud.sh
#
# Qué hace:
#   - Prueba el origin (http://localhost:3000/health). Si falla UMBRAL veces
#     seguidas → reinicia wa-backend (pm2). Cubre el caso "colgado" que pm2 no
#     detecta (el proceso vive pero no responde).
#   - Si el origin está bien pero la URL pública (por el túnel) falla → el
#     problema es el túnel → reinicia cloudflared.
#   - Registra cada acción en logs/monitor-salud.log con hora UTC.
#   - Cooldown: no reinicia el mismo servicio más de una vez cada COOLDOWN s,
#     para no entrar en bucle si la causa persiste (p. ej. BD caída).
#
# No imprime nada ni escribe en el log cuando todo está bien (silencioso).
set -u

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

BASE="$HOME/apps/wa"
LOG_DIR="$BASE/logs"
LOG="$LOG_DIR/monitor-salud.log"
ORIGIN="http://localhost:3000/health"
PUBLICO="https://wa.losolivoscucuta.com/health"
UMBRAL=2          # fallos consecutivos antes de actuar
COOLDOWN=600      # segundos mínimos entre reinicios del mismo servicio
MAX_LOG=5242880   # 5 MB: rota el log al superarlo

mkdir -p "$LOG_DIR"
ts()  { date -u '+%Y-%m-%d %H:%M:%SZ'; }
log() { echo "$(ts) $*" >> "$LOG"; }

# Rotación simple del log.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt "$MAX_LOG" ]; then
  mv -f "$LOG" "$LOG.1"
fi

http() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null; }

# Contadores de fallos consecutivos (archivos de estado).
inc_fallo() { # $1=clave -> imprime el nuevo conteo
  local f="$LOG_DIR/.fail_$1" n
  n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$f"
  echo "$n"
}
reset_fallo() { rm -f "$LOG_DIR/.fail_$1"; }

# Cooldown por servicio.
puede_reiniciar() { # $1=clave
  local f="$LOG_DIR/.last_restart_$1" last now
  last=$(cat "$f" 2>/dev/null || echo 0)
  now=$(date +%s)
  [ $(( now - last )) -ge "$COOLDOWN" ]
}
marca_reinicio() { date +%s > "$LOG_DIR/.last_restart_$1"; }

CODE_ORIGIN=$(http "$ORIGIN")

if [ "$CODE_ORIGIN" = "200" ]; then
  reset_fallo origin
  # Origin sano: comprobar el camino público (túnel Cloudflare).
  CODE_PUB=$(http "$PUBLICO")
  if [ "$CODE_PUB" = "200" ]; then
    reset_fallo tunel
  else
    n=$(inc_fallo tunel)
    log "TUNEL degradado: origin OK pero publico=$CODE_PUB (fallo consecutivo $n)"
    if [ "$n" -ge "$UMBRAL" ] && puede_reiniciar tunel; then
      log "-> reiniciando cloudflared"
      if sudo -n systemctl restart cloudflared 2>>"$LOG"; then
        marca_reinicio tunel
        reset_fallo tunel
        log "cloudflared reiniciado"
      else
        log "ERROR: no se pudo reiniciar cloudflared (revisar sudoers NOPASSWD)"
      fi
    fi
  fi
else
  # Origin caído o colgado.
  n=$(inc_fallo origin)
  log "ORIGIN caido: /health=$CODE_ORIGIN (fallo consecutivo $n)"
  if [ "$n" -ge "$UMBRAL" ] && puede_reiniciar origin; then
    log "-> reiniciando wa-backend"
    if pm2 restart wa-backend >/dev/null 2>>"$LOG"; then
      marca_reinicio origin
      reset_fallo origin
      log "wa-backend reiniciado"
    else
      log "ERROR: no se pudo reiniciar wa-backend"
    fi
  fi
fi
