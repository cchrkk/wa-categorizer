import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { childLogger } from './logger.js';

const log = childLogger('media');

const EXT_BY_MIME = {
  'audio/ogg; codecs=opus': 'ogg',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

export function extFromMimetype(mimetype, fallback = 'bin') {
  if (!mimetype) return fallback;
  const clean = String(mimetype).split(';')[0].trim();
  return EXT_BY_MIME[mimetype] || EXT_BY_MIME[clean] || clean.split('/')[1] || fallback;
}

/**
 * Salva un buffer su data/out/<subdir>/<nome>.
 * Ritorna il percorso assoluto del file scritto.
 */
export function saveBuffer(buffer, { subdir, basename, extension }) {
  const dir = path.join(paths.data, 'out', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(basename).replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const file = path.join(dir, `${safe}.${extension}`);
  fs.writeFileSync(file, buffer);
  log.debug({ file, bytes: buffer.length }, 'media saved');
  return file;
}

export function tmpPath(name, extension, subdir = 'tmp') {
  const dir = path.join(paths.data, 'out', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.${extension}`);
}

/** Le conversioni in corso non si toccano: potrebbero servire a un comando in esecuzione. */
const TMP_GRACE_MS = 60 * 60 * 1000;

/**
 * Cancella i media vecchi da data/out/.
 *
 *   retentionDays > 0   rimuove i file più vecchi di N giorni
 *   retentionDays = 0   rimuove tutto tranne ciò che è stato toccato nell'ultima ora
 *   retentionDays < 0   non fa niente
 *
 * `tmp/` è sempre spazzatura e viene svuotata a ogni giro.
 * Ritorna { removed, freed, failed, skipped }.
 */
export function sweepMedia(retentionDays) {
  if (retentionDays < 0) return { skipped: true, removed: 0, freed: 0, failed: 0 };

  const outDir = path.join(paths.data, 'out');
  if (!fs.existsSync(outDir)) return { skipped: false, removed: 0, freed: 0, failed: 0 };

  const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86400000 : Date.now() - TMP_GRACE_MS;

  let removed = 0;
  let freed = 0;
  let failed = 0;
  const esempi = [];

  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(outDir, entry.name);
    const isTmp = entry.name === 'tmp';

    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      // tmp/ ha sempre la sua grazia, le altre cartelle seguono la retention
      if (isTmp ? st.mtimeMs >= Date.now() - TMP_GRACE_MS : st.mtimeMs >= cutoff) continue;

      try {
        fs.unlinkSync(file);
        removed += 1;
        freed += st.size;
        if (esempi.length < 5) esempi.push(entry.name === 'tmp' ? `tmp/${name}` : `${entry.name}/${name}`);
      } catch (err) {
        failed += 1;
        log.warn({ file, err: err.message }, 'cannot delete');
      }
    }

    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch { /* ignore */ }
  }

  if (removed) {
    log.info(
      { removed, freed: `${(freed / 1048576).toFixed(2)} MB`, retentionDays, examples: esempi },
      'media cleanup',
    );
  }
  return { skipped: false, removed, freed, failed };
}

/** Cancella subito un media, usato quando la retention è 0. */
export function deleteMedia(file) {
  if (!file) return false;
  try {
    fs.unlinkSync(file);
    log.debug({ file }, 'media deleted right after processing');
    return true;
  } catch (err) {
    log.warn({ file, err: err.message }, 'cannot delete the media');
    return false;
  }
}
