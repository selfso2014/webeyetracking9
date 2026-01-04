// js/webpack-loader.js
// Minimal loader for webpack-compiled module outputs that reference __webpack_exports__ / __webpack_require__.
// Implemented specifically to execute the SeeSo SDK file shipped as seeso/dist/seeso.js.

export async function loadWebpackModule(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch module: ${url} (HTTP ${res.status})`);
  }

  const code = await res.text();

  // Export object populated by the module.
  const __webpack_exports__ = {};

  // The SeeSo file imports a few core-js polyfill modules at the very top.
  // They are side-effect imports and are not required on modern browsers.
  // We stub them to an empty module to keep the runtime self-contained.
  function __webpack_require__(_moduleId) {
    return {};
  }

  // webpack helper: define getter exports
  __webpack_require__.d = (exports, definition) => {
    for (const key in definition) {
      if (Object.prototype.hasOwnProperty.call(definition, key) && !Object.prototype.hasOwnProperty.call(exports, key)) {
        Object.defineProperty(exports, key, {
          enumerable: true,
          get: definition[key],
        });
      }
    }
  };

  // webpack helper: mark as ES module
  __webpack_require__.r = (exports) => {
    if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    }
    Object.defineProperty(exports, '__esModule', { value: true });
  };

  // webpack helper: compatibility for non-harmony modules
  __webpack_require__.n = (module) => {
    const getter = module && module.__esModule ? () => module.default : () => module;
    __webpack_require__.d(getter, { a: getter });
    return getter;
  };

  // Execute the module.
  const fn = new Function('__webpack_exports__', '__webpack_require__', `${code}\nreturn __webpack_exports__;`);
  return fn(__webpack_exports__, __webpack_require__);
}
