/**
 * Polyfill minimal UTF-8 de TextEncoder / TextDecoder pour Hermes.
 *
 * Hermes n'expose pas (ou incompletement) ces globaux. Le module crypto E2E
 * (Signal) en a besoin pour convertir string <-> Uint8Array. On installe une
 * implementation UTF-8 pure JS UNIQUEMENT si le global manque — sur les
 * moteurs qui les fournissent (JSC, futurs Hermes), on ne touche a rien.
 *
 * Suffisant pour notre usage : encode/decode UTF-8, pas de gestion des
 * encodages exotiques ni du streaming.
 */

function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    // paires de substitution (caracteres hors BMP, ex: emoji)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes) {
  const arr =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes && bytes.buffer ? bytes.buffer : bytes || []);
  let out = '';
  let i = 0;
  while (i < arr.length) {
    const b0 = arr[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = arr[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = arr[i++] & 0x3f;
      const b2 = arr[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else if (b0 >= 0xf0) {
      const b1 = arr[i++] & 0x3f;
      const b2 = arr[i++] & 0x3f;
      const b3 = arr[i++] & 0x3f;
      let cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function needsPolyfill(Ctor, method, sample) {
  if (typeof Ctor !== 'function') return true;
  try {
    const inst = new Ctor();
    return typeof inst[method] !== 'function' || sample(inst) == null;
  } catch (e) {
    return true;
  }
}

if (
  needsPolyfill(global.TextEncoder, 'encode', (i) => i.encode('a')) ||
  needsPolyfill(global.TextDecoder, 'decode', (i) => i.decode(new Uint8Array([97])))
) {
  class PolyfillTextEncoder {
    get encoding() {
      return 'utf-8';
    }
    encode(str) {
      return utf8Encode(String(str == null ? '' : str));
    }
  }

  class PolyfillTextDecoder {
    constructor(label) {
      this.encoding = (label || 'utf-8').toLowerCase();
    }
    decode(bytes) {
      if (bytes == null) return '';
      return utf8Decode(bytes);
    }
  }

  global.TextEncoder = PolyfillTextEncoder;
  global.TextDecoder = PolyfillTextDecoder;
}
