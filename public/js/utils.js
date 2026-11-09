/**
 * AylusMusic - Pure Utility Functions
 */

/**
 * Sanitize text to prevent XSS
 * @param {string} str 
 * @returns {string}
 */
export function sanitize(str) {
  if (typeof str !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    "/": '&#x2F;'
  };
  return str.replace(/[&<>"'/]/g, (char) => map[char]);
}

/**
 * Format seconds to mm:ss or hh:mm:ss
 * @param {number} seconds 
 * @returns {string}
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const sec = Math.floor(seconds);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;
  
  const paddedSecs = remainingSecs < 10 ? `0${remainingSecs}` : `${remainingSecs}`;
  
  if (hrs > 0) {
    const paddedMins = mins < 10 ? `0${mins}` : `${mins}`;
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}

/**
 * Format bytes to readable string (KB, MB, GB)
 * @param {number} bytes 
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Generate unique ID
 * @param {string} prefix 
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Sleep promise
 * @param {number} ms 
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce a function call
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Normalize string for search and comparison
 * @param {string} text 
 * @returns {string}
 */
export function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Fuzzy similarity matching score between 0.0 and 1.0
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number}
 */
export function fuzzySimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Match a target track with a candidate local file
 * @param {{ title: string, artist?: string }} track 
 * @param {{ name: string, title?: string, artist?: string }} fileItem 
 * @returns {number} 0.0 to 1.0 score
 */
export function scoreTrackMatch(track, fileItem) {
  const fileNameClean = (fileItem.name || '').replace(/\.[^/.]+$/, '');
  const trackTitle = track.title || '';
  const trackArtist = track.artist || '';

  // Direct title match
  const titleScore = fuzzySimilarity(trackTitle, fileItem.title || fileNameClean);
  
  // Combined artist + title match in filename (e.g. "Coldplay - Yellow.mp3")
  const combined = `${trackArtist} ${trackTitle}`;
  const fileScore = fuzzySimilarity(combined, fileNameClean);

  return Math.max(titleScore, fileScore);
}

/**
 * Compress an image or blob to lightweight WebP data URL
 * @param {Blob|File|string} source 
 * @param {number} maxDimension 
 * @returns {Promise<string>}
 */
export async function compressImageToWebP(source, maxDimension = 256) {
  return new Promise((resolve) => {
    // If not in browser or canvas missing, return source
    if (typeof window === 'undefined' || !window.document) {
      resolve(typeof source === 'string' ? source : '');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const webpData = canvas.toDataURL('image/webp', 0.82);
          resolve(webpData);
          return;
        }
      } catch (err) {
        console.warn('Image compression fallback:', err);
      }
      resolve(typeof source === 'string' ? source : '');
    };

    img.onerror = () => {
      resolve(typeof source === 'string' ? source : '');
    };

    if (source instanceof Blob || source instanceof File) {
      img.src = URL.createObjectURL(source);
    } else if (typeof source === 'string') {
      img.src = source;
    } else {
      resolve('');
    }
  });
}
