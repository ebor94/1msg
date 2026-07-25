'use strict';

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Transcodifica un buffer de audio (webm/mp4/ogg/…) a ogg/opus mono 48k, apto
 * para nota de voz de WhatsApp. Usa ffmpeg vía archivos temporales.
 * @returns {Promise<Buffer>} ogg/opus.
 */
async function transcodificarAOgg(bufferEntrada) {
  const base = path.join(os.tmpdir(), `voz-${crypto.randomBytes(8).toString('hex')}`);
  const entrada = `${base}.in`;
  const salida = `${base}.ogg`;
  await fs.writeFile(entrada, bufferEntrada);
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', entrada, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', salida]);
      let err = '';
      ff.stderr.on('data', (d) => { err += d.toString(); });
      ff.on('error', reject); // ffmpeg no instalado / no ejecutable
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salió ${code}: ${err.slice(-200)}`))));
    });
    return await fs.readFile(salida);
  } finally {
    await fs.rm(entrada, { force: true }).catch(() => {});
    await fs.rm(salida, { force: true }).catch(() => {});
  }
}

module.exports = { transcodificarAOgg };
